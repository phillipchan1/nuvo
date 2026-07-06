// draftBrief — the Brief lens's AI first draft + interrogation, with NO new
// edge deploy: it rides the already-deployed `agent` chat endpoint as a one-shot
// JSON completion. All grounding is composed CLIENT-side from the snapshot the
// lens already holds (item, its steps, the domain charter/context), so the
// draft never depends on what the server-side context happens to include.
//
// The answer→brief loop (docs/grooming-lenses.md §5): answering a question
// never silently mutates the document — the answers ride along here and the
// model proposes REVISED sections, which the human adjudicates again.
//
// Failure is a graceful state, not a wall: callers catch and fall back to
// manual entry (the lens works with AI off).

import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";
import {
  domainById,
  projectsOf,
  tasksOf,
  type Initiative,
  type ItemBrief,
  type Project,
  type VerticalData,
} from "./vertical";

export interface BriefAnswer {
  question: string;
  answer: string;
}

const MAX_LINES = 6;

function grounding(
  d: VerticalData,
  kind: "project" | "initiative",
  item: Project | Initiative,
): string {
  const domain = domainById(d, item.domainId);
  const lines: string[] = [
    `Kind: ${kind === "initiative" ? "initiative (a named bet, weeks-to-months horizon)" : "project (an execution container, days-to-weeks)"}`,
    `Name: ${item.name}`,
    `Outcome: ${item.outcome.trim() || "(none yet)"}`,
    `Description: ${item.description.trim() || "(none)"}`,
    `Finish line: ${item.targetDate ?? "(none yet)"}`,
  ];
  if (domain) {
    lines.push(`Life area: ${domain.name}${domain.charter ? ` — ${domain.charter}` : ""}`);
    if (domain.context) {
      lines.push(`Area scope: ${domain.context.scope}`);
      if (domain.context.boundary) lines.push(`Area boundary (what does NOT belong): ${domain.context.boundary}`);
    }
  }
  if (kind === "project") {
    const open = tasksOf(d, item.id).filter((t) => t.status !== "done").map((t) => t.title);
    lines.push(open.length ? `Existing open steps: ${open.slice(0, 12).join(" · ")}` : "Existing open steps: none yet");
  } else {
    const i = item as Initiative;
    const kids = projectsOf(d, i.id).map((p) => p.name);
    lines.push(kids.length ? `Projects under it: ${kids.slice(0, 10).join(" · ")}` : "Projects under it: none yet");
    lines.push(
      i.keyResults.length
        ? `Key results: ${i.keyResults.map((k) => `${k.name} (${k.baseline}→${k.target}${k.unit})`).join(" · ")}`
        : "Key results: none yet",
    );
  }
  return lines.join("\n");
}

function buildPrompt(
  d: VerticalData,
  kind: "project" | "initiative",
  item: Project | Initiative,
  current: ItemBrief | null,
  answers: BriefAnswer[],
): string {
  const revise = answers.length > 0 || (current && (current.scope.length || current.doneWhen.length));
  const head =
    "SYSTEM OVERRIDE — DOCUMENT DRAFTING MODE.\n" +
    "You are drafting a grooming brief (scope + acceptance) for ONE item. Do NOT call any tools. Do NOT create, modify, schedule, or delete anything. Treat your data snapshot as background only.\n" +
    "Reply with ONLY a raw JSON object — no prose, no markdown fences, no <suggestions> block.\n";
  const shape =
    `Return exactly this shape (arrays of short plain-English lines, no ids):\n` +
    `{"outcome": "the definition of done in ONE crisp line (draft one if missing; sharpen the existing one only if it's genuinely weak, else repeat it)", "scope": ["what IS in scope — 2-4 lines"], "nonGoals": ["explicitly out — 1-3 lines"], "doneWhen": ["concrete acceptance criteria — 2-4 lines"], "constraints": ["real constraints — 0-2 lines, [] if none"], "openQuestions": ["the 2-3 sharpest questions a world-class PM would ask to expose the fuzz"]}`;

  const parts = [head, "Item to brief:", grounding(d, kind, item)];

  if (revise) {
    if (current) {
      parts.push(
        "The human has ALREADY accepted this brief so far (do not repeat these lines back; propose only refinements or additions that the answers below justify):",
        JSON.stringify({ scope: current.scope, nonGoals: current.nonGoals, doneWhen: current.doneWhen, constraints: current.constraints }),
      );
    }
    if (answers.length) {
      parts.push(
        "The human answered your interrogation. Fold these answers into revised/added lines — the answers are the grooming:",
        answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n"),
      );
    }
    parts.push(
      "Propose ONLY new or sharpened lines per section ([] where nothing changes), and only openQuestions that are still genuinely open — never re-ask an answered question.",
    );
  }

  parts.push(shape);
  return parts.join("\n\n");
}

export interface BriefDraft {
  brief: ItemBrief;
  /** a proposed one-line outcome (null when the model had nothing useful). */
  outcome: string | null;
}

/** Coerce unknown JSON into a well-formed draft (arrays of trimmed strings). */
function coerce(raw: unknown): BriefDraft {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_LINES)
      : [];
  const outcome = typeof obj.outcome === "string" ? obj.outcome.trim() : "";
  return {
    brief: {
      scope: arr(obj.scope),
      nonGoals: arr(obj.nonGoals),
      doneWhen: arr(obj.doneWhen),
      constraints: arr(obj.constraints),
      openQuestions: arr(obj.openQuestions),
    },
    outcome: outcome || null,
  };
}

/** Pull the JSON object out of a model reply that may carry stray prose/fences. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * One drafting round-trip. Throws on network / auth / parse failure — the lens
 * catches and stays usable by hand.
 */
export async function draftBrief(opts: {
  d: VerticalData;
  kind: "project" | "initiative";
  item: Project | Initiative;
  /** the accepted-so-far document, for the revise loop. */
  current?: ItemBrief | null;
  /** answered interrogation questions to fold in. */
  answers?: BriefAnswer[];
}): Promise<BriefDraft> {
  const prompt = buildPrompt(opts.d, opts.kind, opts.item, opts.current ?? null, opts.answers ?? []);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? supabaseAnonKey;
  const res = await fetch(`${supabaseUrl}/functions/v1/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `draftBrief failed (${res.status})`);
  }

  // The endpoint replies over SSE; accumulate the text chunks and prefer the
  // final "d" event's content (post-sanitize) when present.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamed = "";
  let finalText: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt: { t?: string; v?: string; content?: string; msg?: string };
      try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.t === "c" && typeof evt.v === "string") streamed += evt.v;
      else if (evt.t === "d" && typeof evt.content === "string") finalText = evt.content;
      else if (evt.t === "e") throw new Error(evt.msg || "agent error");
    }
  }

  return coerce(extractJson(finalText || streamed));
}
