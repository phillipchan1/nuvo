// Hand-off (D-250, docs/handoff.md) — the pure half.
//
// What an agent sees when a task is handed to it: the three MCP tools, the
// brief, and the doorbell's wake message. Zero imports, no I/O, so the Worker
// and the tests read the same shapes. The Worker (`worker/src/handoffHttp.ts`,
// `mcpHttp.ts`) owns the SQL and the network.

import { isHandedOff } from "./planningRules.ts";

/** The kernel owns the rule (both runtimes count demand); re-said here so the
 *  hand-off's own callers find it beside the tools. */
export { isHandedOff };

export const LIST_HANDOFFS = "list_handoffs";
export const GET_HANDOFF = "get_handoff";
export const REPORT_HANDOFF = "report_handoff";

export const HANDOFF_TOOL_NAMES = [LIST_HANDOFFS, GET_HANDOFF, REPORT_HANDOFF] as const;

export type HandoffOutcome = "open" | "done" | "back" | "recalled";

export interface HandoffToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const HANDOFF_TOOLS: HandoffToolDef[] = [
  {
    name: LIST_HANDOFFS,
    description:
      "The tasks the operator has handed to YOU (this token) and that are still open. Call this when your routine runs or the Nuvo doorbell rings. Each item has a task_id for get_handoff. Empty means nothing is waiting.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: GET_HANDOFF,
    description:
      "The full brief for one handed task: the task, its steps, the operator's note to you, its project (outcome, other work), its domain, earlier hand-offs and why they came back. Read it before doing the work.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string", description: "From list_handoffs." } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: REPORT_HANDOFF,
    description:
      "Answer a hand-off. outcome 'done' completes the task in Nuvo (it reads 'Done by <you>'); 'back' returns it to the operator unchanged. Always include a short note: what you did, or what stopped you. Every hand-off you take must end in one of these.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        outcome: { type: "string", enum: ["done", "back"] },
        note: { type: "string", description: "What you did, or why it's coming back. Plain text, a few sentences." },
      },
      required: ["task_id", "outcome", "note"],
      additionalProperties: false,
    },
  },
];

export const AGENT_NOTE_MAX = 4000;
export const OWNER_NOTE_MAX = 1000;

/** Trim and cap a note. Never throws; an absent note is "". */
export function cleanNote(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const t = raw.replace(/\r\n/g, "\n").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function parseReportOutcome(raw: unknown): "done" | "back" | null {
  return raw === "done" || raw === "back" ? raw : null;
}

// ── The brief ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export interface BriefInput {
  task: Row;
  /** the open hand-off being answered */
  handoff: Row;
  agentName: string;
  steps: Row[];
  project: Row | null;
  /** other tasks of the same project (any status) */
  projectTasks: Row[];
  domain: Row | null;
  /** earlier, closed hand-offs of this task, newest first */
  history: Row[];
  /** e.g. https://app.nuvo.day/?task=<id> */
  link: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
/** A timestamp as ISO — the Postgres driver hands back Dates, REST hands back strings. */
const ts = (v: unknown): string | null =>
  v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v.toISOString()) : str(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const MAX_SIBLINGS = 25;

export function buildHandoffBrief(i: BriefInput) {
  const t = i.task;
  const siblings = i.projectTasks.filter((r) => r.id !== t.id && !r.parent_task_id);
  const openWork = siblings
    .filter((r) => r.status !== "done" && r.status !== "trashed")
    .slice(0, MAX_SIBLINGS)
    .map((r) => str(r.title))
    .filter(Boolean);
  const doneWork = siblings
    .filter((r) => r.status === "done")
    .sort((a, b) => (ts(b.completed_at) ?? "").localeCompare(ts(a.completed_at) ?? ""))
    .slice(0, 10)
    .map((r) => str(r.title))
    .filter(Boolean);

  return {
    handed_to: i.agentName,
    handed_at: ts(i.handoff.created_at),
    note_from_operator: str(i.handoff.note),
    task: {
      id: t.id,
      title: str(t.title) ?? "(untitled)",
      notes: str(t.notes),
      steps: i.steps
        .slice()
        .sort((a, b) => (num(a.sort_order) ?? 0) - (num(b.sort_order) ?? 0))
        .map((s) => ({ title: str(s.title) ?? "", done: s.status === "done" })),
      day: str(t.do_date),
      deadline: str(t.deadline),
      duration_minutes: num(t.duration_minutes),
      priority: str(t.priority) && t.priority !== "none" ? t.priority : null,
      energy: str(t.energy),
      times_rolled: num(t.roll_count) ?? 0,
      link: i.link,
    },
    project: i.project
      ? {
          name: str(i.project.name),
          done_means: str(i.project.outcome),
          status: str(i.project.status),
          other_open_work: openWork,
          recently_done: doneWork,
        }
      : null,
    domain: i.domain ? str(i.domain.name) : null,
    earlier_handoffs: i.history.map((h) => ({
      outcome: str(h.outcome),
      operator_note: str(h.note),
      agent_note: str(h.agent_note),
      at: ts(h.closed_at) ?? ts(h.created_at),
    })),
    answer_with:
      "report_handoff with outcome 'done' and a note of what you did, or outcome 'back' and a note of what stopped you.",
  };
}

// ── The doorbell ────────────────────────────────────────────────────────────

/** The only thing the doorbell carries: that there is work, never the work. */
export function doorbellBody(openCount: number) {
  const n = Math.max(1, openCount);
  return {
    source: "nuvo",
    message: `Nuvo: you have ${n} task${n === 1 ? "" : "s"} handed to you. Call list_handoffs on the Nuvo MCP server, then get_handoff for each, and answer every one with report_handoff.`,
  };
}

/** A doorbell must be https and name a host. The Worker also SSRF-checks it. */
export function validDoorbellUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname) return null;
  return u.toString();
}
