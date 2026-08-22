/**
 * One task, many query fragments.
 *
 * Inbox / day / scheduled / sprint each hold their own copy. A naive last-source
 * wins merge is how a just-completed row stayed open on the rail: Today had
 * `done`, the scheduled fragment still had `planned`, and scheduled was later
 * in the loop. Pick the newest `updated_at`. A trash with a newer stamp is
 * gone, even if an older fragment still carries the live row.
 */

import type { Task } from "./types";

function ts(t: Task): string {
  return t.updated_at ?? "";
}

/** Newest row per id. Trashed winners are omitted — they are not on any surface. */
export function mergeTaskLists(lists: readonly (readonly Task[])[]): Map<string, Task> {
  const best = new Map<string, Task>();
  for (const list of lists) {
    for (const t of list) {
      const prev = best.get(t.id);
      if (!prev || ts(t) >= ts(prev)) best.set(t.id, t);
    }
  }
  for (const [id, t] of best) {
    if (t.status === "trashed") best.delete(id);
  }
  return best;
}
