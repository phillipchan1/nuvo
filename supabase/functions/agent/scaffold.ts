// Project scaffolding: read the project's place in the vertical (outcome,
// initiative, domain intention, existing tasks) and propose an ORDERED task
// list. Proposes only — nothing is inserted here. The client renders the
// draft diff and writes accepted tasks itself as `backlog` rows (the agent
// proposes into quiet pools; only the user promotes work toward the calendar).

import { admin } from "../_shared/admin.ts";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);

export interface ScaffoldDraft {
  title: string;
  energy: "deep" | "decide" | "delegate" | "quick" | null;
  durationMins: number;
  rationale?: string;
}

export async function scaffoldProject(
  userId: string,
  projectId: string,
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

  const initiative = initiativeRes.data;
  const domain = domainRes.data;
  const existing = tasksRes.data ?? [];

  const prompt = `You are scaffolding a personal project into concrete, ordered tasks.

Project: ${project.name}
Outcome (what "done" looks like): ${project.outcome || "(not stated)"}
${project.description ? `Description: ${project.description}` : ""}
${initiative ? `Parent initiative: ${initiative.name} — ${initiative.outcome}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}

Existing tasks (do NOT duplicate these):
${existing.length ? existing.map((t) => `- [${t.status}] ${t.title}`).join("\n") : "(none yet)"}

Propose the missing tasks that get this project from its current state to the outcome.
Rules:
- 3 to 8 tasks, in execution order (a → b → c). First task should be startable today.
- Each task is one sitting of work: concrete verb-first title, 15–120 minutes.
- energy is one of: "deep" (focused maker work), "decide" (judgment call), "delegate" (hand off / follow up), "quick" (low-friction win).
- rationale: max 8 words on why it's needed.

Respond with JSON only: {"tasks":[{"title":string,"energy":string,"duration_minutes":number,"rationale":string}]}`;

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);

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
