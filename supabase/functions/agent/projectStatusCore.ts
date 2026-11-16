// The pure half of projectStatus.ts — no I/O, no `admin`, so the Worker's agent
// snapshot (worker/src/agentExec.ts) and the battery import the SAME counting the
// edge function uses. The rule itself is the kernel's `effectiveProjectStatus`.

import { effectiveProjectStatus } from "../_shared/planningRules.ts";

/** Open / total non-trashed tasks per project, from `{ project_id, status }` rows. */
export function projectTaskRollup(
  tasks: readonly { project_id?: unknown; status?: unknown }[],
): Map<string, { open: number; total: number }> {
  const roll = new Map<string, { open: number; total: number }>();
  for (const t of tasks) {
    const pid = typeof t.project_id === "string" ? t.project_id : null;
    if (!pid || t.status === "trashed") continue;
    const e = roll.get(pid) ?? { open: 0, total: 0 };
    e.total++;
    if (t.status !== "done") e.open++;
    roll.set(pid, e);
  }
  return roll;
}

/** Rows with `status` replaced by the effective one. */
export function applyEffectiveStatus<T extends { id: string; status: string }>(
  rows: readonly T[],
  roll: Map<string, { open: number; total: number }>,
): T[] {
  return rows.map((r) => {
    const e = roll.get(r.id);
    return { ...r, status: effectiveProjectStatus(r.status ?? "", e?.open ?? 0, e?.total ?? 0) };
  });
}
