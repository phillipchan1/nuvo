/**
 * Leftovers on the Schedule grid that outlive the gesture that made them.
 *
 * A recurring event's delete / drag / scope prompt can leave FullCalendar's
 * "in hand" state behind — a drag mirror or a `.fc-event-dragging` /
 * `.fc-event-resizing` original — on blocks that are no longer there: a white
 * box with an accent ring and a drop shadow, until a reload. Nothing here
 * decides what a block *is*; it only puts away what is still "in hand" once
 * every gesture has ended.
 */

/** FullCalendar's select-mirror (the composer's ghost) is NOT in hand — only a
 *  mirror of a real block is. `data-drag-mirror` is stamped on mount for those. */
export const DRAG_MIRROR_ATTR = "data-drag-mirror";
export const STRAY_ATTR = "data-stray";

/** Put away every in-hand leftover under `root`. Call only when no pointer is
 *  down, no gesture is live and the grid sync isn't paused. Returns how many
 *  it touched, so a test (and a curious dev) can see it work. */
export function sweepStrayGhosts(root: ParentNode): number {
  let n = 0;
  root.querySelectorAll<HTMLElement>(".fc-event-dragging, .fc-event-resizing").forEach((el) => {
    el.classList.remove("fc-event-dragging", "fc-event-resizing");
    n++;
  });
  root.querySelectorAll<HTMLElement>(`.fc-event-mirror[${DRAG_MIRROR_ATTR}]:not([${STRAY_ATTR}])`).forEach((el) => {
    el.setAttribute(STRAY_ATTR, "");
    n++;
  });
  return n;
}

/** The selected block was on the grid and now isn't — it was deleted, so its
 *  selection has nothing to light. A block selected *before* it lands (a fresh
 *  copy, an undo) was never in `prev`, so it is left alone. */
export function selectionLost(
  prev: ReadonlySet<string>,
  next: ReadonlySet<string>,
  cursor: string | null,
): boolean {
  return Boolean(cursor && prev.has(cursor) && !next.has(cursor));
}
