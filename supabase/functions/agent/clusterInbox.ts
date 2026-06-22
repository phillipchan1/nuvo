// Theme the inbox — the Plan ritual's "loose captures → a few named runs"
// advance. Reads the user's raw inbox tasks (status = 'inbox', no project yet)
// and groups the ones that are *like each other* into a handful of themed runs,
// each with a name and an energy register. Clustering is judgment (which loose
// captures belong together); the client maps the groups back to real tasks and
// lets composeWeek place them. Proposes only — no writes here.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";

type Energy = "deep" | "decide" | "quick";

export interface InboxGroup {
  name: string;
  energy: Energy;
  taskIds: string[];
}

const ENERGIES: Energy[] = ["deep", "decide", "quick"];

export async function clusterInbox(
  userId: string,
  _input: { today?: string } = {},
): Promise<{ groups: InboxGroup[] }> {
  // The inbox is the loose-capture pile: status 'inbox', not yet committed.
  const { data: rows, error } = await admin
    .from("tasks")
    .select("id, title, duration_minutes")
    .eq("user_id", userId)
    .eq("status", "inbox")
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);

  const tasks = (rows ?? []).filter((t) => (t.title ?? "").trim());
  if (tasks.length === 0) return { groups: [] };

  const list = tasks
    .map((t, i) => `${i + 1}. [${t.id}] ${t.title}${t.duration_minutes ? ` (${t.duration_minutes}m)` : ""}`)
    .join("\n");

  const prompt = `You are organizing a person's inbox of loose, unprocessed task captures into a few themed runs that can each become one focus block on the calendar.

Group the captures by what they actually have in common — the kind of work and the context — so that everything in a run could plausibly be knocked out in one sitting. Good themes read like "Errands", "Emails to send", "Calls to make", "Church admin", "Reading", "Finance paperwork". Avoid one giant catch-all; avoid a separate group per item. 2–6 groups is typical.

For each run pick an energy register:
- "deep": focused, cognitively heavy making/thinking work.
- "decide": reviewing, replying, judging, planning — moderate focus.
- "quick": shallow errands, quick messages, admin, small chores.

Every capture must land in exactly one group; do not invent or drop ids.

Inbox captures:
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
  if (leftover.length) groups.push({ name: "Inbox", energy: "quick", taskIds: leftover });

  return { groups };
}
