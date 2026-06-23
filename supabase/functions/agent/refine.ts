// Project refine: read a project's existing backlog and propose three kinds of
// improvement in one pass —
//   · edits     — typo / wording fixes for existing task titles (only changed)
//   · additions — concrete steps the backlog is missing
//   · order     — a sensible execution order for the existing tasks
// Proposes only. Nothing is written here; the client renders a reviewable diff
// and applies what the user accepts (the agent proposes into quiet pools; only
// the user promotes work). Sibling of scaffold.ts.

import { admin } from "../_shared/admin.ts";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);

export interface RefineAddition {
  title: string;
  energy: "deep" | "decide" | "delegate" | "quick" | null;
  durationMins: number;
  rationale?: string;
}
export interface RefineEdit {
  id: string;
  original: string;
  title: string;
  reason?: string;
}
export interface RefineResult {
  edits: RefineEdit[];
  additions: RefineAddition[];
  order: string[];
}

export async function refineProject(userId: string, projectId: string): Promise<RefineResult> {
  const { data: project, error } = await admin
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (error || !project) throw new Error("Project not found");

  const [initiativeRes, domainRes, tasksRes] = await Promise.all([
    project.initiative_id
      ? admin.from("initiatives").select("name, outcome").eq("id", project.initiative_id).maybeSingle()
      : Promise.resolve({ data: null }),
    project.domain_id
      ? admin.from("domains").select("name, intention").eq("id", project.domain_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("tasks")
      .select("id, title, status")
      .eq("project_id", projectId)
      .not("status", "in", '("done","trashed")')
      .order("sort_order"),
  ]);

  const existing = (tasksRes.data ?? []) as { id: string; title: string; status: string }[];
  const validIds = new Set(existing.map((t) => t.id));
  const byId = new Map(existing.map((t) => [t.id, t.title] as const));

  const initiative = initiativeRes.data as { name: string; outcome: string } | null;
  const domain = domainRes.data as { name: string; intention: string } | null;

  const prompt = `You are refining a personal project's task backlog. Improve it in three ways.

Project: ${project.name}
Outcome (what "done" looks like): ${project.outcome || "(not stated)"}
${project.description ? `Description: ${project.description}` : ""}
${initiative ? `Parent initiative: ${initiative.name} — ${initiative.outcome}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}

Existing tasks (id — title):
${existing.length ? existing.map((t) => `${t.id} — ${t.title}`).join("\n") : "(none yet)"}

Produce:
1. "edits": fix typos and tighten weak wording in EXISTING titles. Only include a task if its title genuinely changes. Keep the author's voice; make titles concrete and verb-first. Each: {"id": <existing id>, "title": <improved title>, "reason": <max 6 words>}.
2. "additions": tasks the backlog is MISSING to reach the outcome. Do NOT duplicate existing tasks. 0 to 6 of them, each one sitting of work (15–120 min), verb-first. Each: {"title": string, "energy": "deep"|"decide"|"delegate"|"quick", "duration_minutes": number, "rationale": <max 8 words>}.
3. "order": the EXISTING task ids in a sensible execution order (a→b→c, first startable today). Use only ids from the list above; include every existing id exactly once. Omit if there are fewer than 2 existing tasks.

Respond with JSON only: {"edits":[...],"additions":[...],"order":[...]}`;

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
  let parsed: { edits?: unknown[]; additions?: unknown[]; order?: unknown[] } = {};
  try {
    parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw new Error("Could not parse the refine proposal");
  }

  const edits: RefineEdit[] = (parsed.edits ?? [])
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => {
      const id = String(e.id ?? "");
      const title = String(e.title ?? "").trim();
      return { id, original: byId.get(id) ?? "", title, reason: e.reason ? String(e.reason) : undefined };
    })
    // keep only real changes to tasks that still exist
    .filter((e) => validIds.has(e.id) && e.title.length > 0 && e.title !== e.original);

  const additions: RefineAddition[] = (parsed.additions ?? [])
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      title: String(t.title ?? "").trim(),
      energy: ENERGIES.has(String(t.energy)) ? (String(t.energy) as RefineAddition["energy"]) : "quick",
      durationMins: Math.min(480, Math.max(5, Number(t.duration_minutes) || 30)),
      rationale: t.rationale ? String(t.rationale) : undefined,
    }))
    .filter((t) => t.title.length > 0)
    .slice(0, 8);

  // order: only valid ids, deduped, and only if it actually re-sequences things
  const seen = new Set<string>();
  let order = (parsed.order ?? [])
    .map((id) => String(id))
    .filter((id) => validIds.has(id) && !seen.has(id) && seen.add(id));
  // any existing ids the model dropped keep their place at the tail
  for (const t of existing) if (!seen.has(t.id)) order.push(t.id);
  const currentOrder = existing.map((t) => t.id);
  if (order.length < 2 || order.every((id, i) => id === currentOrder[i])) order = [];

  return { edits, additions, order };
}
