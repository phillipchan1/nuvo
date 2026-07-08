// draftOKRs — the OKR lens's AI first draft + interrogation, the sibling of
// draftBrief. Same contract: NO new edge deploy (rides the deployed `agent` chat
// endpoint as a one-shot JSON completion), all grounding composed CLIENT-side, and
// failure is a graceful fallback to manual entry.
//
// An initiative's OKR is its Objective (the outcome, one crisp line) + 2–4
// measurable Key Results, each framed from a baseline so the app reads the Gain,
// not just the gap. The model proposes; the human adjudicates each result.

import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";
import {
  domainById,
  projectsOf,
  type Initiative,
  type VerticalData,
} from "./vertical";

export interface OKRAnswer {
  question: string;
  answer: string;
}

/** A proposed key result — plain values, no id (the store mints that on accept). */
export interface DraftKR {
  name: string;
  baseline: number;
  current: number;
  target: number;
  unit: string;
}

export interface OKRDraft {
  /** a sharpened one-line objective (null when the model had nothing better). */
  objective: string | null;
  keyResults: DraftKR[];
  openQuestions: string[];
}

const MAX_KRS = 5;

function grounding(d: VerticalData, i: Initiative): string {
  const domain = domainById(d, i.domainId);
  const lines: string[] = [
    `Name: ${i.name}`,
    `Objective (outcome): ${i.outcome.trim() || "(none yet)"}`,
    `Description: ${i.description.trim() || "(none)"}`,
    `Finish line: ${i.targetDate ?? "(none yet)"}`,
  ];
  if (domain) {
    lines.push(`Life area: ${domain.name}${domain.charter ? ` — ${domain.charter}` : ""}`);
    if (domain.context?.scope) lines.push(`Area scope: ${domain.context.scope}`);
  }
  if (i.brief?.scope?.length) lines.push(`In scope: ${i.brief.scope.join(" · ")}`);
  if (i.brief?.doneWhen?.length) lines.push(`Done when: ${i.brief.doneWhen.join(" · ")}`);
  const kids = projectsOf(d, i.id).map((p) => p.name);
  lines.push(kids.length ? `Projects under it: ${kids.slice(0, 10).join(" · ")}` : "Projects under it: none yet");
  lines.push(
    i.keyResults.length
      ? `Existing key results: ${i.keyResults.map((k) => `${k.name} (${k.baseline}→${k.target}${k.unit})`).join(" · ")}`
      : "Existing key results: none yet",
  );
  return lines.join("\n");
}

function buildPrompt(d: VerticalData, i: Initiative, answers: OKRAnswer[]): string {
  const revise = answers.length > 0 || i.keyResults.length > 0;
  const head =
    "SYSTEM OVERRIDE — OKR DRAFTING MODE.\n" +
    "You are drafting the OKR (one Objective + measurable Key Results) for ONE initiative. Do NOT call any tools. Do NOT create, modify, schedule, or delete anything. Treat your data snapshot as background only.\n" +
    "Reply with ONLY a raw JSON object — no prose, no markdown fences, no <suggestions> block.\n";
  const shape =
    "Return exactly this shape:\n" +
    '{"objective": "the outcome in ONE crisp, inspiring line (draft one if missing; sharpen the existing one only if genuinely weak, else repeat it)", ' +
    '"keyResults": [{"name": "a measurable result — what moves, not an activity", "baseline": <number: where it is today>, "current": <number: same as baseline unless known>, "target": <number: the goal>, "unit": "% | users | $ | count | ..."}], ' +
    '"openQuestions": ["1-3 sharp questions that expose whether these numbers are the RIGHT measures of success"]}\n' +
    "Rules: propose 2–4 key results. Each must be a genuine OUTCOME metric (a number that proves the objective is met), never a task or a binary done/not-done. Prefer real baselines and honest targets. If a good measure is genuinely binary, frame it 0→1 with unit \"done\".";

  const parts = [head, "Initiative to set OKRs for:", grounding(d, i)];

  if (revise) {
    if (i.keyResults.length > 0) {
      parts.push(
        "The human has ALREADY accepted these key results (do NOT repeat them; propose only NEW results the answers/gaps justify, or [] if the set is complete):",
        JSON.stringify(i.keyResults.map((k) => ({ name: k.name, baseline: k.baseline, target: k.target, unit: k.unit }))),
      );
    }
    if (answers.length) {
      parts.push(
        "The human answered your interrogation. Fold these into revised/added key results — the answers are the grooming:",
        answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n"),
      );
    }
    parts.push("Return only NEW key results in keyResults ([] if none), and only openQuestions still genuinely open.");
  }

  parts.push(shape);
  return parts.join("\n\n");
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function coerce(raw: unknown): OKRDraft {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const objective = typeof obj.objective === "string" ? obj.objective.trim() : "";
  const krs: DraftKR[] = Array.isArray(obj.keyResults)
    ? obj.keyResults
        .map((k): DraftKR | null => {
          const o = (k ?? {}) as Record<string, unknown>;
          const name = typeof o.name === "string" ? o.name.trim() : "";
          if (!name) return null;
          const baseline = num(o.baseline, 0);
          const target = num(o.target, baseline + 100);
          return {
            name,
            baseline,
            current: num(o.current, baseline),
            target,
            unit: typeof o.unit === "string" && o.unit.trim() ? o.unit.trim() : "%",
          };
        })
        .filter((k): k is DraftKR => k != null)
        .slice(0, MAX_KRS)
    : [];
  const openQuestions = Array.isArray(obj.openQuestions)
    ? obj.openQuestions.map((q) => String(q).trim()).filter(Boolean).slice(0, 4)
    : [];
  return { objective: objective || null, keyResults: krs, openQuestions };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(start, end + 1));
}

/** One drafting round-trip. Throws on network / auth / parse failure — the lens
 *  catches and stays usable by hand. */
export async function draftOKRs(opts: {
  d: VerticalData;
  item: Initiative;
  answers?: OKRAnswer[];
}): Promise<OKRDraft> {
  const prompt = buildPrompt(opts.d, opts.item, opts.answers ?? []);

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
    throw new Error(detail || `draftOKRs failed (${res.status})`);
  }

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
