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

import { admin } from "../_shared/admin.ts";
import { llmKey, llmBaseUrl, llmModel, llmHeaders } from "./llm.ts";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);

export interface ScaffoldDraft {
  title: string;
  energy: "deep" | "decide" | "delegate" | "quick" | null;
  durationMins: number;
  rationale?: string;
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
}

/** The shared proposer — grounds the LLM in the project's place in the
 *  vertical and returns an ordered, de-duplicated starter task list. */
async function proposeTasks(input: ScaffoldInput): Promise<{ tasks: ScaffoldDraft[] }> {
  const existing = input.existing ?? [];
  const prompt = `You are scaffolding a personal project into concrete, ordered tasks.

Project: ${input.name}
Outcome (what "done" looks like): ${input.outcome || "(not stated)"}
${input.description ? `Description: ${input.description}` : ""}
${input.initiative ? `Parent initiative: ${input.initiative.name} — ${input.initiative.outcome}` : ""}
${input.domain ? `Life domain: ${input.domain.name}. Standing intention: ${input.domain.intention}` : ""}

The person's own steps so far (their plan — do NOT duplicate or restate these):
${existing.length ? existing.map((t) => `- [${t.status}] ${t.title}`).join("\n") : "(none yet)"}
${input.guidance ? `\nThe person redirected: "${input.guidance}". Honor this redirection.` : ""}

Propose ONLY the tasks their plan is missing to reach the outcome — fill the gaps, don't rewrite their work.
Rules:
- If they already have steps, add just the genuine gaps (0–4). If the list is empty, propose 3 to 8 to get started. Always in execution order (a → b → c); the first should be startable today.
- Each task is one sitting of work: concrete verb-first title, 15–120 minutes.
- energy is one of: "deep" (focused maker work), "decide" (judgment call), "delegate" (hand off / follow up), "quick" (low-friction win).
- rationale: max 8 words on why it's needed.

Respond with JSON only: {"tasks":[{"title":string,"energy":string,"duration_minutes":number,"rationale":string}]}`;

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

  const completion = await res.json();
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
    }))
    .filter((t) => t.title.length > 0)
    .slice(0, 10);

  return { tasks };
}

export async function scaffoldProject(
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
  } = {},
): Promise<{ tasks: ScaffoldDraft[] }> {
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
      .order("sort_order"),
  ]);

  // Fold the human's just-typed steps in alongside any saved ones, so Nuvo
  // reads the person's own plan as the spine and only proposes the gaps.
  const saved = tasksRes.data ?? [];
  const drafts = (opts.draftTitles ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((title) => ({ title, status: "backlog" }));

  return proposeTasks({
    name: project.name,
    outcome: project.outcome,
    description: opts.description?.trim() || project.description,
    initiative: initiativeRes.data,
    domain: domainRes.data,
    existing: [...saved, ...drafts],
    guidance: opts.guidance,
  });
}

/** Draft a not-yet-created project's first tasks from what the user has typed
 *  in the create moment. Grounds in the parent initiative / domain if given. */
export async function scaffoldDraft(
  userId: string,
  body: {
    name?: string;
    outcome?: string;
    description?: string;
    initiativeId?: string | null;
    domainId?: string | null;
  },
): Promise<{ tasks: ScaffoldDraft[] }> {
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

  return proposeTasks({
    name,
    outcome: String(body.outcome ?? "").trim(),
    description: body.description ? String(body.description).trim() : undefined,
    initiative: initiativeRes.data,
    domain: domainRes.data,
    existing: [],
  });
}
