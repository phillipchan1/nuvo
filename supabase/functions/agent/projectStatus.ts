// The status a project's WEEK RULES read — the tasks decide, through the kernel's
// `effectiveProjectStatus`, exactly as the app's `buildVertical` does. Feeding the
// raw `projects.status` into the slate is how the chat and the crown disagreed:
// tick a project's last task and the app read it shipped while the agent still
// read it open (and the reverse for a reopened one).

import { admin } from "../_shared/admin.ts";
import { applyEffectiveStatus, projectTaskRollup } from "./projectStatusCore.ts";
export { applyEffectiveStatus, projectTaskRollup } from "./projectStatusCore.ts";

/** Fetch each project's task counts and return the rows with their effective
 *  status. Chunked so a large portfolio never builds an over-long `in` list,
 *  and paged — PostgREST stops at 1000 rows, and a short read would drop open
 *  tasks and call an unfinished project complete. */
export async function withEffectiveStatus<T extends { id: string; status: string }>(
  userId: string,
  rows: readonly T[],
): Promise<T[]> {
  if (!rows.length) return [...rows];
  const ids = rows.map((r) => r.id);
  const tasks: { project_id?: unknown; status?: unknown }[] = [];
  const PAGE = 1000;
  for (let i = 0; i < ids.length; i += 100) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("tasks")
        .select("id, project_id, status")
        .eq("user_id", userId)
        .in("project_id", ids.slice(i, i + 100))
        .neq("status", "trashed")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as { project_id?: unknown; status?: unknown }[];
      tasks.push(...page);
      if (page.length < PAGE) break;
    }
  }
  return applyEffectiveStatus(rows, projectTaskRollup(tasks));
}
