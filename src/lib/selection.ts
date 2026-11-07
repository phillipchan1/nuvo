// Multi-selection — the rules, once, for every list that can hold a pick.
//
// The desktop rail and the phone's Tasks screen both select rows, and they had
// grown two private copies of the same four moves (toggle · range · clear ·
// "is this still real"). Neither pruned: switch the rail to Inbox, or complete a
// selected row, and the id stayed in the set — so the bar said "4 selected"
// while the acts reached only the two you could still see. These are the
// moves, as pure functions over a set of ids, so a surface says *what* happened
// (a modifier-click, a hold, a tap on a slot's header) and never re-decides what
// it means.

export type IdSet = ReadonlySet<string>;

/** ⌘-click / a tap while selecting: take the id in, or back out. */
export function toggleId(ids: IdSet, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * ⇧-click: every id between the anchor and `to`, inclusive, in list order.
 * With no usable anchor the range is just `to` (a first ⇧-click selects one row
 * rather than doing nothing). Null when `to` isn't in the list at all.
 */
export function rangeBetween(order: readonly string[], anchor: string | null, to: string): Set<string> | null {
  const hi = order.indexOf(to);
  if (hi === -1) return null;
  const lo = anchor && order.includes(anchor) ? order.indexOf(anchor) : hi;
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  return new Set(order.slice(a, b + 1));
}

/**
 * Drop every id that is no longer in the list. Returns the SAME set when nothing
 * was dropped, so an effect can call it on every render of the list and only
 * cause a state change when something actually vanished.
 */
export function pruneTo(ids: IdSet, order: readonly string[]): IdSet {
  if (ids.size === 0) return ids;
  const live = new Set(order);
  let dropped = false;
  const kept = new Set<string>();
  for (const id of ids) {
    if (live.has(id)) kept.add(id);
    else dropped = true;
  }
  return dropped ? kept : ids;
}

export type Coverage = "all" | "some" | "none";

/** How much of a group (a slot's tasks, a section) the selection holds. */
export function coverage(ids: IdSet, members: readonly string[]): Coverage {
  if (members.length === 0) return "none";
  let held = 0;
  for (const m of members) if (ids.has(m)) held++;
  return held === 0 ? "none" : held === members.length ? "all" : "some";
}

/**
 * A tap on a group's mark: if the group is whole in the selection take it back
 * out, otherwise (empty or partial) fill it. Partial → full, never partial →
 * empty — the second tap is the undo of the first, and the first never throws
 * away what you'd already picked.
 */
export function toggleGroup(ids: IdSet, members: readonly string[]): Set<string> {
  const next = new Set(ids);
  if (coverage(ids, members) === "all") members.forEach((m) => next.delete(m));
  else members.forEach((m) => next.add(m));
  return next;
}

/**
 * Which popover the selection must not sit beside. A task's popover, a slot's
 * popover and the centred record are all "this one thing" surfaces; the moment
 * you are holding several rows, one of them being open is a lie about what the
 * next act will touch. (The row's ⌘/⇧-click `stopPropagation` also kept the
 * popover's own click-away from ever hearing the press, so nothing else would
 * have closed it.)
 */
export function selectionClosesOverlay(overlay: string): boolean {
  return overlay === "task" || overlay === "task-record" || overlay === "slot";
}
