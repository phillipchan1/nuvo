// The Blueprint flow's intelligence: from a stated bet (name + outcome +
// domain), propose the whole subtree — measurable key results, 2-4 projects,
// and each project's first ordered tasks. Proposal only; the client renders
// the draft and writes accepted pieces itself (into quiet backlog).

import type { AgentDeps } from "./agentDeps.ts";
import { llmFor } from "./llmCore.ts";
import { shapeProjectProposals, type ProjectProposal } from "../_shared/projectDraft.ts";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);

export interface BlueprintProposal {
  keyResults: { name: string; baseline: number; target: number; unit: string }[];
  projects: {
    name: string;
    outcome: string;
    tasks: { title: string; energy: string; durationMins: number }[];
  }[];
}

export async function blueprintInitiative(
  deps: AgentDeps,
  userId: string,
  input: {
    name: string;
    outcome: string;
    description?: string;
    domainId?: string;
    guidance?: string;
    /** Project names the person already typed under this bet. Nuvo complements
     *  them — proposing key results + only the MISSING projects, never restating
     *  what's there. Human-drives, Nuvo-fills-the-gaps. */
    draftProjectNames?: string[];
  },
): Promise<BlueprintProposal> {
  const admin = deps.db;
  const { completeJSON } = llmFor(deps.env);
  const domain = input.domainId
    ? (await admin.from("domains").select("name, intention").eq("id", input.domainId).eq("user_id", userId).maybeSingle()).data
    : null;

  const own = (input.draftProjectNames ?? []).map((n) => String(n).trim()).filter(Boolean);

  const prompt = `You are shaping a personal initiative (a bet with a finish line) into an executable structure.

Initiative: ${input.name}
Outcome (what "done" looks like): ${input.outcome || "(not stated — infer a crisp one)"}
${input.description ? `Notes: ${input.description}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}
${input.guidance ? `The person redirected: "${input.guidance}". Honor this redirection.` : ""}
${own.length ? `\nThe person's own projects under this bet (do NOT duplicate or restate these):\n${own.map((n) => `- ${n}`).join("\n")}` : ""}

Propose:
- 2-3 key results: measurable, each with a numeric baseline (usually the current state, often 0), a target, and a short unit ("%", "mo", "d", "" for counts).
- ${own.length ? "ONLY the projects their plan is missing (0–3) — fill the gaps around their own projects, don't rewrite them" : "2-4 projects, in rough execution order"}, each with a one-line outcome and 3-6 first tasks in execution order (a → b → c). Task titles are verb-first and one-sitting sized (15–120 minutes). energy is one of "deep", "decide", "delegate", "quick".

Respond with JSON only:
{"keyResults":[{"name":string,"baseline":number,"target":number,"unit":string}],
 "projects":[{"name":string,"outcome":string,"tasks":[{"title":string,"energy":string,"duration_minutes":number}]}]}`;

  const raw = await completeJSON<{
    keyResults?: unknown[];
    projects?: unknown[];
  }>(prompt);

  const keyResults = (raw.keyResults ?? [])
    .filter((k): k is Record<string, unknown> => typeof k === "object" && k !== null)
    .map((k) => ({
      name: String(k.name ?? "").trim(),
      baseline: Number(k.baseline) || 0,
      target: Number(k.target) || 100,
      unit: String(k.unit ?? ""),
    }))
    .filter((k) => k.name)
    .slice(0, 4);

  const projects = (raw.projects ?? [])
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      name: String(p.name ?? "").trim(),
      outcome: String(p.outcome ?? "").trim(),
      tasks: (Array.isArray(p.tasks) ? p.tasks : [])
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t) => ({
          title: String(t.title ?? "").trim(),
          energy: ENERGIES.has(String(t.energy)) ? String(t.energy) : "quick",
          durationMins: Math.min(480, Math.max(5, Number(t.duration_minutes) || 30)),
        }))
        .filter((t) => t.title)
        .slice(0, 8),
    }))
    .filter((p) => p.name)
    .slice(0, 5);

  return { keyResults, projects };
}

// ── Draft the projects (D-196) ──────────────────────────────────────────────
// The same proposer, one question narrower: an initiative that already exists,
// and the projects its outcome is MISSING, laid across the weeks of its quarter.
// No key results (a different act), no tasks (Draft the path drafts those, one
// project at a time, when the project is about to land). Proposal only — the
// client writes a project when you hold its bar.

export async function draftInitiativeProjects(
  deps: AgentDeps,
  userId: string,
  input: {
    initiativeId: string;
    /** the quarter's week starts, ISO Mondays, in order — the bars' grid */
    weekStarts: string[];
    guidance?: string;
    /** unheld proposals a steer is reshaping */
    redraft?: string[];
  },
): Promise<{ projects: ProjectProposal[] }> {
  const admin = deps.db;
  const { completeJSON } = llmFor(deps.env);
  const weeks = (input.weekStarts ?? []).map(String).filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w)).slice(0, 16);
  if (!weeks.length) throw new Error("No weeks to draft into");
  const { data: initiative, error } = await admin
    .from("initiatives")
    .select("id, name, outcome, description, domain_id")
    .eq("id", input.initiativeId)
    .eq("user_id", userId)
    .single();
  if (error || !initiative) throw new Error("Initiative not found");
  const [domainRes, projectsRes] = await Promise.all([
    initiative.domain_id
      ? admin.from("domains").select("name, intention").eq("id", initiative.domain_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("projects")
      .select("name, outcome, status, start_date, target_date")
      .eq("initiative_id", initiative.id)
      .eq("user_id", userId),
  ]);
  const domain = domainRes.data as { name: string; intention: string } | null;
  const own = ((projectsRes.data ?? []) as { name: string; outcome: string | null; status: string; start_date: string | null; target_date: string | null }[])
    .filter((p) => p.status !== "cancelled");
  // where an existing project sits on this grid, as the model reads it ("W2–W4")
  const weekOf = (iso: string | null) => {
    if (!iso) return null;
    let ix = -1;
    for (let i = 0; i < weeks.length; i++) if (weeks[i] <= iso) ix = i;
    return ix < 0 ? null : ix + 1;
  };
  const ownLine = (p: (typeof own)[number]) => {
    const a = weekOf(p.start_date ?? p.target_date);
    const b = weekOf(p.target_date);
    const at = a && b ? ` (W${a}–W${b})` : "";
    const done = p.status === "complete" ? " [shipped]" : "";
    return `- ${p.name}${p.outcome ? ` — ${p.outcome}` : ""}${at}${done}`;
  };
  const redraft = (input.redraft ?? []).map((n) => String(n).trim()).filter(Boolean);

  const prompt = `You are drafting the projects a personal initiative (a bet with a finish line) is missing.

Initiative: ${initiative.name}
Outcome (what "done" looks like): ${initiative.outcome || "(not stated)"}
${initiative.description ? `Notes: ${initiative.description}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}

The quarter has ${weeks.length} weeks, W1 to W${weeks.length} (W1 starts ${weeks[0]}).
The person's own projects under this initiative (their plan — do NOT duplicate or restate these):
${own.length ? own.map(ownLine).join("\n") : "(none yet)"}
${redraft.length ? `\nReplace these earlier proposals the person hasn't accepted: ${redraft.join("; ")}.` : ""}
${input.guidance ? `\nThe person redirected: "${String(input.guidance).slice(0, 200)}". Honor this redirection.` : ""}

Propose ONLY the projects the outcome is missing — ${own.length ? "0 to 3" : "2 to 5"}, in the order they'd start.
Rules:
- A project is a few weeks of work with its own finish line: a short noun-phrase name (2–5 words) and a one-line outcome that says when it's done.
- Place each in the quarter: start_week (1–${weeks.length}) and weeks (1–${weeks.length}). Earlier work comes first; things that depend on others start after them. Don't run more than three at once, counting the person's own.
- why: max 8 words on what part of the outcome it carries.
- alternatives: 0–2 genuinely different ways to cover the same part of the outcome, each with its own name, outcome, why, start_week, weeks.

Respond with JSON only: {"projects":[{"name":string,"outcome":string,"why":string,"start_week":number,"weeks":number,"alternatives":[{"name":string,"outcome":string,"why":string,"start_week":number,"weeks":number}]}]}`;

  const raw = await completeJSON<{ projects?: unknown[] }>(prompt);
  return { projects: shapeProjectProposals(raw.projects, weeks.length, own.map((p) => p.name)) };
}
