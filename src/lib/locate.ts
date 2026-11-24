// Where is it on the Schedule? (D-226)
//
// Pointing at a task or a project in the rail rings its blocks on the grid, so
// "when will this happen — or won't it?" is answered by looking, not by
// matching a row's time against the week by eye. The rest of the grid stays as
// it is (ring only): this is a read aid, not a mode, so nothing dims.
//
// The rail writes the target here; CalendarPane reads it and rings the
// elements it already stamps (`data-task-id`, `data-slot-id`). Same shape as
// `offerPreview` — a module store, so no surface threads a callback through.
// Nothing here writes data.

import { useSyncExternalStore } from "react";

export interface LocateTarget {
  /** tasks to find — a task's block, or the slot it sits in */
  taskIds: string[];
  /** a project: every block of its work, and its own sittings */
  projectId?: string | null;
  /** slots (sittings) to find by their own id — a block with no task to name */
  slotIds?: string[];
  /** only the blocks on this day: a card that says "Basketball, Wed" must not
   *  ring Tuesday's Basketball too (D-255) */
  dayISO?: string;
}

let current: LocateTarget | null = null;
const listeners = new Set<() => void>();

const same = (a: LocateTarget | null, b: LocateTarget | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.projectId === b.projectId &&
    a.dayISO === b.dayISO &&
    a.taskIds.length === b.taskIds.length &&
    a.taskIds.every((id, i) => id === b.taskIds[i]) &&
    (a.slotIds ?? []).join("|") === (b.slotIds ?? []).join("|"));

export function setLocate(t: LocateTarget | null): void {
  if (same(current, t)) return;
  current = t;
  for (const l of listeners) l();
}

export function getLocate(): LocateTarget | null {
  return current;
}

export function subscribeLocate(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLocate(): LocateTarget | null {
  return useSyncExternalStore(subscribeLocate, () => current, () => null);
}

/** The rail row an element belongs to, read off the marks the rows already
 *  carry: a crown project (`data-crown-key="p:…"`) or any task row. */
export function locateTargetAt(el: Element | null): LocateTarget | null {
  const row = el?.closest?.("[data-crown-key^='p:'], [data-row-task]");
  if (!row) return null;
  const crown = row.getAttribute("data-crown-key");
  if (crown?.startsWith("p:")) return { taskIds: [], projectId: crown.slice(2) };
  const id = row.getAttribute("data-row-task");
  return id ? { taskIds: [id] } : null;
}

/** A crown/tray cursor key → its target ("p:…" is a project, else a task). */
export function locateTargetForKey(key: string | null): LocateTarget | null {
  if (!key) return null;
  return key.startsWith("p:") ? { taskIds: [], projectId: key.slice(2) } : { taskIds: [key] };
}
