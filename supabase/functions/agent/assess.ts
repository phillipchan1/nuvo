// Record assess: a world-class coach's pass over a project OR initiative. Reads
// the record + its children and returns anchored FINDINGS — where the work is
// weak and how to sharpen it — never rewriting anything. The client overlays
// each finding as an inline margin note beside the element it points at; the
// user Accepts (applies the patch) or Dismisses. Assess proposes; the user
// promotes. Sibling of refine.ts / scaffold.ts.
//
//   Initiative → OKR coach: is the objective an outcome (not an activity)? are
//     the KRs measurable, few, ambitious? do the projects actually move a KR?
//   Project    → PM coach: is "done" defined? are tasks right-sized and
//     sequenced? what's the obvious missing step or risk?

import { admin } from "../_shared/admin.ts";
import { llmKey, llmBaseUrl, llmModel, llmHeaders } from "./llm.ts";

export interface AssessPatch {
  kind: "outcome" | "kr" | "title";
  outcome?: string;
  name?: string;
  baseline?: number;
  target?: number;
  unit?: string;
  title?: string;
}
export interface AssessFinding {
  anchor: string; // "objective" | "kr:<id>" | "project:<id>" | "tasks" | "task:<id>" | "general"
  severity: "high" | "medium" | "low";
  issue: string;
  suggestion?: string;
  patch?: AssessPatch;
}
export interface AssessResult { findings: AssessFinding[] }

const SEVERITIES = new Set(["high", "medium", "low"]);

export async function assessRecord(
  userId: string,
  kind: "project" | "initiative",
  id: string,
): Promise<AssessResult> {
  const prompt = kind === "initiative"
    ? await initiativePrompt(userId, id)
    : await projectPrompt(userId, id);

  const key = llmKey();
  const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(key),
    body: JSON.stringify({
      model: llmModel("gpt-5.4-nano", "qwen/qwen3.7-plus-20260602"),
      messages: [{ role: "user", content: prompt.text }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);

  const completion = await res.json();
  let parsed: { findings?: unknown[] } = {};
  try {
    parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw new Error("Could not parse the assessment");
  }

  const findings: AssessFinding[] = (parsed.findings ?? [])
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => normalizeFinding(f, prompt.validAnchors))
    .filter((f): f is AssessFinding => f !== null)
    .slice(0, 12);

  return { findings };
}

function normalizeFinding(f: Record<string, unknown>, valid: Set<string>): AssessFinding | null {
  const anchor = String(f.anchor ?? "").trim();
  const issue = String(f.issue ?? "").trim();
  if (!issue) return null;
  // keep only anchors the client can actually place; unknown → "general"
  const safeAnchor = valid.has(anchor) ? anchor : "general";
  const severity = SEVERITIES.has(String(f.severity)) ? (String(f.severity) as AssessFinding["severity"]) : "medium";
  const suggestion = f.suggestion ? String(f.suggestion).trim() : undefined;

  let patch: AssessPatch | undefined;
  const p = f.patch as Record<string, unknown> | undefined;
  if (p && typeof p === "object") {
    const kind = String(p.kind ?? "");
    if (kind === "outcome" && p.outcome) patch = { kind: "outcome", outcome: String(p.outcome).trim() };
    else if (kind === "title" && p.title) patch = { kind: "title", title: String(p.title).trim() };
    else if (kind === "kr") {
      patch = {
        kind: "kr",
        name: p.name != null ? String(p.name).trim() : undefined,
        baseline: p.baseline != null ? Number(p.baseline) : undefined,
        target: p.target != null ? Number(p.target) : undefined,
        unit: p.unit != null ? String(p.unit).trim() : undefined,
      };
    }
  }

  return { anchor: safeAnchor, severity, issue, suggestion, patch };
}

async function initiativePrompt(userId: string, id: string): Promise<{ text: string; validAnchors: Set<string> }> {
  const { data: init, error } = await admin
    .from("initiatives").select("*").eq("id", id).eq("user_id", userId).single();
  if (error || !init) throw new Error("Initiative not found");

  const [krRes, projRes, domainRes] = await Promise.all([
    admin.from("key_results").select("id, name, baseline, current, target, unit").eq("initiative_id", id),
    admin.from("projects").select("id, name, outcome, status").eq("initiative_id", id),
    init.domain_id ? admin.from("domains").select("name, intention").eq("id", init.domain_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const krs = (krRes.data ?? []) as { id: string; name: string; baseline: number; current: number; target: number; unit: string }[];
  const projects = (projRes.data ?? []) as { id: string; name: string; outcome: string; status: string }[];
  const domain = domainRes.data as { name: string; intention: string } | null;

  const validAnchors = new Set<string>(["objective", "general"]);
  krs.forEach((k) => validAnchors.add(`kr:${k.id}`));
  projects.forEach((p) => validAnchors.add(`project:${p.id}`));

  const text = `You are a world-class OKR coach reviewing one initiative. Be sharp, specific, and kind — a great coach, not a rubber stamp. Point only at real weaknesses; if something is already strong, say nothing about it.

Initiative: ${init.name}
Objective (should be a qualitative OUTCOME, not an activity): ${init.outcome || "(not stated)"}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}

Key results (id — name — baseline→current→target unit):
${krs.length ? krs.map((k) => `kr:${k.id} — ${k.name} — ${k.baseline}→${k.current}→${k.target} ${k.unit}`).join("\n") : "(none — the initiative has no measurable result yet)"}

Projects feeding it (id — name — status):
${projects.length ? projects.map((p) => `project:${p.id} — ${p.name} [${p.status}]`).join("\n") : "(none)"}

Assess against a world-class OKR rubric:
- Objective: is it an inspiring OUTCOME, or is it phrased as an activity/task ("Build…", "Launch…", "Migrate…")? Is it clear what winning looks like?
- Key results: is each one MEASURABLE (a number moving from a baseline to a target), OUTCOME not output, and ambitious-but-real? Are there roughly 2–4 (not 0, not 8)? Flag placeholder KRs like "New result 0→100".
- Coverage: does at least one project plausibly move each KR? Any KR with no project is an unbacked bet; any project that moves no KR is possibly off-strategy.

Return JSON: {"findings":[ ... ]}. Each finding:
{
  "anchor": one of — "objective" | "kr:<id>" | "project:<id>" | "general",
  "severity": "high" | "medium" | "low",
  "issue": one sentence naming the weakness, plainly,
  "suggestion": one sentence of concrete advice (optional),
  "patch": OPTIONAL a directly-applyable fix, only when you can write a confident concrete replacement:
     for the objective: {"kind":"outcome","outcome": "<rewritten outcome one-liner>"}
     for a key result:  {"kind":"kr","name": "<measurable name>","baseline": <num>,"target": <num>,"unit": "<unit>"}
}
Only include a patch when your replacement is genuinely better and concrete. 0–8 findings, most important first. If the initiative is already strong, return {"findings":[]}.`;

  return { text, validAnchors };
}

async function projectPrompt(userId: string, id: string): Promise<{ text: string; validAnchors: Set<string> }> {
  const { data: project, error } = await admin
    .from("projects").select("*").eq("id", id).eq("user_id", userId).single();
  if (error || !project) throw new Error("Project not found");

  const [initRes, domainRes, tasksRes] = await Promise.all([
    project.initiative_id ? admin.from("initiatives").select("name, outcome").eq("id", project.initiative_id).maybeSingle() : Promise.resolve({ data: null }),
    project.domain_id ? admin.from("domains").select("name, intention").eq("id", project.domain_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("tasks").select("id, title, status").eq("project_id", id).not("status", "in", '("done","trashed")').order("sort_order"),
  ]);
  const tasks = (tasksRes.data ?? []) as { id: string; title: string; status: string }[];
  const initiative = initRes.data as { name: string; outcome: string } | null;
  const domain = domainRes.data as { name: string; intention: string } | null;

  const validAnchors = new Set<string>(["objective", "tasks", "general"]);
  tasks.forEach((t) => validAnchors.add(`task:${t.id}`));

  const text = `You are a world-class project manager reviewing one personal project. Be sharp, specific, and kind. Point only at real weaknesses; stay silent on what's already good.

Project: ${project.name}
Goal (what "done" looks like): ${project.outcome || "(not stated)"}
${initiative ? `Parent initiative: ${initiative.name} — ${initiative.outcome}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}

Open tasks (id — title):
${tasks.length ? tasks.map((t) => `task:${t.id} — ${t.title}`).join("\n") : "(none yet)"}

Assess against a world-class PM rubric:
- Goal: is "done" defined as a clear, checkable outcome, or is it vague?
- Tasks: are they right-sized (one sitting), concrete and verb-first, and in a sensible order? Any that are actually several tasks in one?
- Completeness: what's the single most important MISSING step or unaddressed RISK between here and the goal?

Return JSON: {"findings":[ ... ]}. Each finding:
{
  "anchor": one of — "objective" (the goal) | "task:<id>" | "tasks" (the set as a whole) | "general",
  "severity": "high" | "medium" | "low",
  "issue": one sentence naming the weakness, plainly,
  "suggestion": one sentence of concrete advice (optional),
  "patch": OPTIONAL a directly-applyable fix, only when concrete:
     for the goal:   {"kind":"outcome","outcome": "<rewritten goal one-liner>"}
     for a task:     {"kind":"title","title": "<improved task title>"}
}
Only include a patch when your replacement is genuinely better. 0–8 findings, most important first. If the project is already strong, return {"findings":[]}.`;

  return { text, validAnchors };
}
