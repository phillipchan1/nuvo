// Delegation pre-work: the assistant prepares a task — plan of attack, draft
// content where the task implies writing, open questions — and writes it to
// tasks.prework. Execution stays with the user; this removes the blank page.

import { admin } from "../_shared/admin.ts";
import { completeText } from "./llm.ts";

export async function prepareTask(userId: string, taskId: string): Promise<{ prework: string }> {
  const { data: task, error } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();
  if (error || !task) throw new Error("Task not found");

  const [projectRes, initiativeRes, domainRes] = await Promise.all([
    task.project_id
      ? admin.from("projects").select("name, outcome, description").eq("id", task.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    task.initiative_id
      ? admin.from("initiatives").select("name, outcome").eq("id", task.initiative_id).maybeSingle()
      : Promise.resolve({ data: null }),
    task.domain_id
      ? admin.from("domains").select("name, intention").eq("id", task.domain_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const prompt = `You are preparing a task for a busy person so they can start it with zero friction.

Task: ${task.title}
${task.notes ? `Their notes: ${task.notes}` : ""}
${projectRes.data ? `Project: ${projectRes.data.name} — ${projectRes.data.outcome}` : ""}
${initiativeRes.data ? `Initiative: ${initiativeRes.data.name} — ${initiativeRes.data.outcome}` : ""}
${domainRes.data ? `Life domain: ${domainRes.data.name} (${domainRes.data.intention})` : ""}
Estimated effort: ${task.duration_minutes ?? 30} minutes.

Write concise pre-work in markdown:
1. **Approach** — 3-5 crisp steps to do it in one sitting.
2. **Draft** — if the task implies writing (email, message, outline, agenda), include a ready-to-edit draft. Otherwise skip this section.
3. **Watch out** — at most 2 open questions or pitfalls, only if genuinely useful.

Be specific to THIS task, not generic productivity advice. No preamble, no sign-off.`;

  const prework = (await completeText(prompt)).trim();
  if (!prework) throw new Error("The model returned empty pre-work");

  const { error: upErr } = await admin
    .from("tasks")
    .update({ prework, prework_at: new Date().toISOString(), assignee: "me" })
    .eq("id", taskId);
  if (upErr) throw new Error(upErr.message);

  return { prework };
}
