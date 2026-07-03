// Theme the inbox — the Plan ritual's "loose captures → a few named runs"
// advance. Reads the user's raw inbox tasks (status = 'inbox', no project yet)
// and groups the ones that are *like each other* into a handful of themed runs,
// each with a name and an energy register. Clustering is judgment (which loose
// captures belong together); the client maps the groups back to real tasks and
// lets composeWeek place them. Proposes only — no writes here.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";
import { buildProposalContext } from "./proposalContext.ts";

type Energy = "deep" | "decide" | "quick";

export interface InboxGroup {
  name: string;
  energy: Energy;
  taskIds: string[];
}

const ENERGIES: Energy[] = ["deep", "decide", "quick"];

export async function clusterInbox(
  userId: string,
  input: { today?: string; taskIds?: string[] } = {},
): Promise<{ groups: InboxGroup[] }> {
  // Two sources: the raw inbox pile (status 'inbox'), or — when the caller hands
  // explicit ids — an arbitrary set of tasks (e.g. the week's carried/slipped work
  // to re-bundle into themed focus blocks). Same clustering judgment either way.
  const explicit = Array.isArray(input.taskIds) && input.taskIds.length > 0;
  const base = admin
    .from("tasks")
    .select("id, title, duration_minutes, domain_id, project_id, initiative_id")
    .eq("user_id", userId);
  const { data: rows, error } = explicit
    ? await base.in("id", input.taskIds!).order("sort_order").order("created_at")
    : await base.eq("status", "inbox").order("sort_order").order("created_at");
  if (error) throw new Error(error.message);

  const tasks = (rows ?? []).filter((t) => (t.title ?? "").trim());
  if (tasks.length === 0) return { groups: [] };

  // Shared proposal context: domains (with charters), projects, initiatives +
  // resolution — so blocks group by IDENTITY (same domain/project belongs together)
  // and get named with real awareness, not just surface task-title overlap.
  const ctx = await buildProposalContext(userId);
  const involved = [...new Set(tasks.map((t) => ctx.domainIdOf(t)).filter((x): x is string => !!x))];
  const contextSection = involved.length
    ? `The person's areas (domains) these tasks belong to — what each one is:\n${involved.map((id) => ctx.domainBlurb(id)).filter(Boolean).join("\n")}\n\n`
    : "";

  const list = tasks
    .map((t, i) => {
      const dId = ctx.domainIdOf(t);
      const dName = dId ? ctx.domainById.get(dId)?.name : null;
      const pName = t.project_id ? ctx.projectById.get(t.project_id)?.name : null;
      const tag = [dName, pName].filter(Boolean).join(" · ");
      return `${i + 1}. [${t.id}] ${t.title}${t.duration_minutes ? ` (${t.duration_minutes}m)` : ""}${tag ? ` — ${tag}` : ""}`;
    })
    .join("\n");

  const noun = explicit ? "unfinished tasks that have slipped and need re-bundling" : "loose, unprocessed inbox task captures";
  const prompt = `You are organizing a person's ${noun} into a few themed runs that can each become one focus block on the calendar.

${contextSection}Group the tasks by what they actually have in common. STRONGLY prefer keeping work from the same domain or project together — those are one thread, and a focus block should feel coherent. Within a domain, split distinctly different kinds of work apart. Avoid one giant catch-all; avoid a separate group per item. 2–6 groups is typical.

Name each run for what it actually advances: when a run is clearly one domain or project, name it for that (e.g. "SCE Admin", "Frontier — Freedom Group", "Meridian Phase 2"); otherwise name it by the kind of work ("Errands", "Emails to send", "Reading"). Short and concrete.

For each run pick an energy register:
- "deep": focused, cognitively heavy making/thinking work.
- "decide": reviewing, replying, judging, planning — moderate focus.
- "quick": shallow errands, quick messages, admin, small chores.

Every task must land in exactly one group; do not invent or drop ids.

Tasks (each tagged with its domain · project where known):
${list}

Respond with JSON only:
{"groups": [{"name": string, "energy": "deep"|"decide"|"quick", "taskIds": string[]}]}`;

  const raw = await completeJSON<{ groups?: unknown }>(prompt);
  const valid = new Set(tasks.map((t) => t.id));
  const seen = new Set<string>();
  const groups: InboxGroup[] = [];

  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    const gg = g as { name?: unknown; energy?: unknown; taskIds?: unknown };
    const ids = (Array.isArray(gg.taskIds) ? gg.taskIds : [])
      .map((x) => String(x))
      .filter((id) => valid.has(id) && !seen.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => seen.add(id));
    const energy = ENERGIES.includes(gg.energy as Energy) ? (gg.energy as Energy) : "quick";
    const name = String(gg.name ?? "").trim() || "Inbox run";
    groups.push({ name, energy, taskIds: ids });
  }

  // Anything the model dropped still deserves a home — a single swept run so no
  // capture silently vanishes from the proposal.
  const leftover = tasks.map((t) => t.id).filter((id) => !seen.has(id));
  if (leftover.length) groups.push({ name: explicit ? "Carried work" : "Inbox", energy: "quick", taskIds: leftover });

  return { groups };
}
