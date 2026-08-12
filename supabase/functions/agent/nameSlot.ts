// Name a block from what's inside it.
//
// The Schedule's "suggest a name": the user dropped several selected tasks on
// the grid, they became one block, and the block already HAS a name — derived
// from its project, its domain, or the hour of day. This is the one-tap ask for
// a better one.
//
// Proposes only. It writes nothing, and the name it returns lands in the
// popover's input, not on the row — the user still promotes it (P3). So a
// failure here costs nothing: the derived name stands.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";
import { buildProposalContext } from "./proposalContext.ts";
import { slotNamePrompt } from "./slotNaming.ts";

export async function nameSlot(
  userId: string,
  input: { taskIds?: string[] } = {},
): Promise<{ name: string }> {
  const taskIds = (input.taskIds ?? []).filter(Boolean);
  if (taskIds.length === 0) throw new Error("taskIds required — a block is named by its contents");

  const { data: rows, error } = await admin
    .from("tasks")
    .select("id, title, duration_minutes, domain_id, project_id, initiative_id")
    .eq("user_id", userId)
    .in("id", taskIds)
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);

  const tasks = (rows ?? []).filter((t) => (t.title ?? "").trim());
  if (tasks.length === 0) throw new Error("Nothing in that block to name yet");

  // Same context every other proposal endpoint reads, so a name comes back in
  // the user's own vocabulary ("SCE admin") rather than a generic paraphrase.
  const ctx = await buildProposalContext(userId);
  const involved = [
    ...new Set(tasks.map((t) => ctx.domainIdOf(t)).filter((x): x is string => !!x)),
  ];
  const contextSection = involved.length
    ? `The person's areas these tasks belong to — what each one is:\n${
      involved.map((id) => ctx.domainBlurb(id)).filter(Boolean).join("\n")
    }\n\n`
    : "";

  const list = tasks
    .map((t, i) => {
      const dId = ctx.domainIdOf(t);
      const dName = dId ? ctx.domainById.get(dId)?.name : null;
      const pName = t.project_id ? ctx.projectById.get(t.project_id)?.name : null;
      const tag = [dName, pName].filter(Boolean).join(" · ");
      return `${i + 1}. ${t.title}${t.duration_minutes ? ` (${t.duration_minutes}m)` : ""}${
        tag ? ` — ${tag}` : ""
      }`;
    })
    .join("\n");

  const out = await completeJSON<{ name?: string }>(slotNamePrompt(contextSection, list));
  const name = String(out?.name ?? "").trim();
  if (!name) throw new Error("Could not think of a name for that block");
  return { name };
}
