import type { Task } from "./types";

/**
 * Checking off a future occurrence of a series, while today's is still open,
 * almost always meant today's. The Schedule can be a week ahead (a trackpad
 * swipe, Sunday-start vs the Monday planning week) so the chip under the
 * pointer is next Thursday's row while Today still holds this Thursday's.
 */
export function resolveCompleteTarget(
  task: Task,
  pool: readonly Task[],
  todayISO: string,
): Task {
  if (!task.recurrence_id || !task.do_date || task.do_date <= todayISO) return task;
  const sibling = pool.find(
    (t) =>
      t.id !== task.id &&
      t.recurrence_id === task.recurrence_id &&
      t.do_date === todayISO &&
      t.status !== "done" &&
      t.status !== "trashed",
  );
  return sibling ?? task;
}
