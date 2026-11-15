// Project scaffolding: read the project's place in the vertical (outcome,
// initiative, domain intention, existing tasks) and propose an ORDERED task
// list. Proposes only — nothing is inserted here. The client renders the
// draft diff and writes accepted tasks itself as `backlog` rows (the agent
// proposes into quiet pools; only the user promotes work toward the calendar).
//
// Two entry points share one proposer:
//   scaffoldProject — for a saved project (drill-in "scaffold with Nuvo").
//   scaffoldDraft   — for a project still being typed in the create moment,
//                     so the first tasks can be drafted BEFORE it exists.

import type { AgentDeps } from "./agentDeps.ts";
import { llmFor } from "./llmCore.ts";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);

// Words that say nothing about WHICH work a title is.
const FILLER = new Set(
  "a an the and or of to for in on with by at from into as is be it its this that your my our their them new first final draft write create make build implement wire do set up add define review update finish complete correctly properly".split(" "),
);
const contentWords = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/s$/, ""))
      .filter((w) => w.length > 2 && !FILLER.has(w)),
  );

/** A proposal restates one of the person's steps when the shorter title's
 *  content words are almost all in the other ("Implement the pricing toggle to
 *  switch Annual vs Monthly" vs "Wire the pricing toggle"). The prompt asks the
 *  model not to; a small model still does, so the proposer drops them (D-216). */
export function restates(proposal: string, own: string): boolean {
  const a = contentWords(proposal);
  const b = contentWords(own);
  const small = a.size <= b.size ? a : b;
  const big = small === a ? b : a;
  if (small.size < 2) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared >= 2 && shared / small.size >= 0.75;
}

export interface ScaffoldDraft {
  title: string;
  energy: "deep" | "decide" | "delegate" | "quick" | null;
  durationMins: number;
  rationale?: string;
  /** Where it goes in the person's own list: the exact title of their step it
   *  comes straight after, "START" for before all of them, or absent when it
   *  simply follows the previous proposal (Draft the path, D-193). */
  after?: string;
  /** Other ways to put the same step — a different scope or wording. The client
   *  offers them on ⇥; it never picks one for you. */
  alternatives?: { title: string; durationMins: number }[];
}

interface ScaffoldInput {
  name: string;
  outcome: string;
  description?: string;
  initiative?: { name: string; outcome: string } | null;
  domain?: { name: string; intention: string } | null;
  existing?: { title: string; status: string }[];
  /** A one-line redirect from Tending's reshape loop — steers the next draft. */
  guidance?: string;
  /** Steps Nuvo proposed that the person hasn't kept yet, being redrafted by
   *  `guidance`. Replace these; don't repeat them unless the steer keeps them. */
  redraft?: string[];
  /** A steer's measurable part, held by the client too (D-216): at most this
   *  many tasks, each at most this many minutes. */
  maxCount?: number;
  maxMinutes?: number;
}

/** The shared proposer — grounds the LLM in the project's place in the
 *  vertical and returns an ordered, de-duplicated starter task list. */
async function proposeTasks(deps: AgentDeps, input: ScaffoldInput): Promise<{ tasks: ScaffoldDraft[] }> {
  const { llmKey, llmBaseUrl, llmModel, llmHeaders } = llmFor(deps.env);
  const existing = input.existing ?? [];
  const prompt = `You are scaffolding a personal project into concrete, ordered tasks.

Project: ${input.name}
Outcome (what "done" looks like): ${input.outcome || "(not stated)"}
${input.description ? `Description: ${input.description}` : ""}
${input.initiative ? `Parent initiative: ${input.initiative.name} — ${input.initiative.outcome}` : ""}
${input.domain ? `Life domain: ${input.domain.name}. Standing intention: ${input.domain.intention}` : ""}

The person's own steps so far (their plan — do NOT duplicate or restate these):
${existing.length ? existing.map((t) => `- [${t.status}] ${t.title}`).join("\n") : "(none yet)"}
${input.redraft?.length ? `\nYour previous proposal, which the person is reshaping (replace it, don't append to it):\n${input.redraft.map((t) => `- ${t}`).join("\n")}` : ""}
${input.guidance ? `\nThe person redirected: "${input.guidance}". Honor this redirection.${input.redraft?.length ? ` Measure it against your previous proposal: "fewer" means clearly fewer items than it had (about half); "smaller" means every item under 45 minutes; never restate one of the person's own steps under another name.` : ""}` : ""}

Propose ONLY the tasks their plan is missing to reach the outcome — fill the gaps, don't rewrite their work.
Rules:
- If they already have steps, add just the genuine gaps (0–5). If the list is empty, propose 3 to 5 to get started — the first sittings that make real progress, not every task the project will ever need. Always in execution order (a → b → c); the first should be startable today.
- Each task is one sitting of work: concrete verb-first title, 15–90 minutes; most are 30–45.${input.maxCount ? `
- Return AT MOST ${input.maxCount} tasks. Keep the foundational steps that must come first and the one that finishes the outcome; drop the nice-to-haves.` : ""}${input.maxMinutes ? `
- Every task is at most ${input.maxMinutes} minutes — split anything bigger.` : ""}
- energy is one of: "deep" (focused maker work), "decide" (judgment call), "delegate" (hand off / follow up), "quick" (low-friction win).
- rationale: one plain sentence, max 12 words, on why the outcome needs it. No "this ensures".
- after: where it belongs among THEIR steps — the exact title of their step it comes straight after, or "START" if it comes before all of them. Omit it when it simply follows your previous proposal. With no steps of theirs, omit it.
- alternatives: 0–2 other versions of the same step (a smaller or larger scope, or a different way to do it), each with its own duration_minutes. Only when a real choice exists.

Respond with JSON only: {"tasks":[{"title":string,"energy":string,"duration_minutes":number,"rationale":string,"after"?:string,"alternatives"?:[{"title":string,"duration_minutes":number}]}]}`;

  const key = llmKey();
  const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(key),
    body: JSON.stringify({
      model: llmModel("gpt-5.4-nano", "qwen/qwen3.7-plus-20260602"),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);

  const completion = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  let parsed: { tasks?: unknown[] } = {};
  try {
    parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw new Error("Could not parse the scaffold proposal");
  }

  const tasks: ScaffoldDraft[] = (parsed.tasks ?? [])
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      title: String(t.title ?? "").trim(),
      energy: ENERGIES.has(String(t.energy)) ? (String(t.energy) as ScaffoldDraft["energy"]) : "quick",
      durationMins: Math.min(480, Math.max(5, Number(t.duration_minutes) || 30)),
      rationale: t.rationale ? String(t.rationale) : undefined,
      after: typeof t.after === "string" && t.after.trim() ? t.after.trim() : undefined,
      alternatives: Array.isArray(t.alternatives)
        ? t.alternatives
            .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
            .map((a) => ({
              title: String(a.title ?? "").trim(),
              durationMins: Math.min(480, Math.max(5, Number(a.duration_minutes) || 30)),
            }))
            .filter((a) => a.title.length > 0)
            .slice(0, 2)
        : undefined,
    }))
    .filter((t) => t.title.length > 0)
    .filter((t) => !existing.some((e) => restates(t.title, e.title)))
    .slice(0, 10);

  return { tasks };
}

export async function scaffoldProject(
  deps: AgentDeps,
  userId: string,
  projectId: string,
  opts: {
    guidance?: string;
    /** The human's own steps, typed but not yet saved. Nuvo proposes what's
     *  MISSING around them rather than guessing the whole list cold —
     *  enrich-not-replace. The policy is human-drives, Nuvo-fills-the-gaps. */
    draftTitles?: string[];
    /** A freshly-typed context line (may not be persisted yet) — overrides the
     *  stored description so Nuvo reasons from what the person just told it. */
    description?: string;
    /** Unkept proposals a steer is reshaping (Draft the path). */
    redraft?: string[];
    maxCount?: number;
    maxMinutes?: number;
  } = {},
): Promise<{ tasks: ScaffoldDraft[] }> {
  const admin = deps.db;
  const { data: project, error } = await admin
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (error || !project) throw new Error("Project not found");

  const [initiativeRes, domainRes, tasksRes] = await Promise.all([
    project.initiative_id
      ? admin.from("initiatives").select("name, outcome, description").eq("id", project.initiative_id).maybeSingle()
      : Promise.resolve({ data: null }),
    project.domain_id
      ? admin.from("domains").select("name, intention").eq("id", project.domain_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("tasks")
      .select("title, status, energy, duration_minutes")
      .eq("project_id", projectId)
      .neq("status", "trashed")
      .is("parent_task_id", null)
      .order("sort_order"),
  ]);

  // Fold the human's just-typed steps in alongside any saved ones, so Nuvo
  // reads the person's own plan as the spine and only proposes the gaps.
  const saved = tasksRes.data ?? [];
  const drafts = (opts.draftTitles ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((title) => ({ title, status: "backlog" }));

  return proposeTasks(deps, {
    name: project.name,
    outcome: project.outcome,
    description: opts.description?.trim() || project.description,
    initiative: initiativeRes.data,
    domain: domainRes.data,
    existing: [...saved, ...drafts],
    guidance: opts.guidance,
    redraft: opts.redraft,
    maxCount: opts.maxCount,
    maxMinutes: opts.maxMinutes,
  });
}

/** Draft a not-yet-created project's first tasks from what the user has typed
 *  in the create moment. Grounds in the parent initiative / domain if given. */
export async function scaffoldDraft(
  deps: AgentDeps,
  userId: string,
  body: {
    name?: string;
    outcome?: string;
    description?: string;
    initiativeId?: string | null;
    domainId?: string | null;
  },
): Promise<{ tasks: ScaffoldDraft[] }> {
  const admin = deps.db;
  const name = String(body.name ?? "").trim();
  if (!name) throw new Error("Name the project first");

  const [initiativeRes, domainRes] = await Promise.all([
    body.initiativeId
      ? admin.from("initiatives").select("name, outcome, description").eq("id", body.initiativeId).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    body.domainId
      ? admin.from("domains").select("name, intention").eq("id", body.domainId).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return proposeTasks(deps, {
    name,
    outcome: String(body.outcome ?? "").trim(),
    description: body.description ? String(body.description).trim() : undefined,
    initiative: initiativeRes.data,
    domain: domainRes.data,
    existing: [],
  });
}
