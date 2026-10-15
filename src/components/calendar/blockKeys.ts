/**
 * The calendar grid as a list — the rows `useTaskListKeys` walks when a block is
 * selected (D-158).
 *
 * The grid speaks the rail's grammar (e ⌫ t v ↵ ⌘E ⌘D . j k), so it needs what a
 * list has: rows in an order. A block's order is its time — j is "the next thing
 * that happens", across days, tasks, events and slots alike. The rows are built
 * from the same inputs FullCalendar is fed (`fcEvents`), so the order can't
 * disagree with what is drawn.
 *
 * And the moves only a grid has, as arithmetic: ⌥↑/⌥↓ nudge a block a quarter
 * hour, ⌥←/⌥→ a day, ⌥⇧↑/⌥⇧↓ resize it. Pure, so the rules are tested rather than
 * eyeballed on a 15-minute block.
 */

import { addDays } from "date-fns";
import type { CalendarBlockInput } from "../../lib/syncCalendarEvents";
import { parseDateISO } from "../../lib/dates";

export type BlockKind = "task" | "slot" | "event";

export interface GridBlock {
  /** FullCalendar's id — `task:…`, `slot:…`, `evt:…`. The selection's key. */
  id: string;
  kind: BlockKind;
  /** The row behind it (task / slot / external event id). */
  refId: string;
  start: number;
  /** Exclusive. An anytime chip ends at the next midnight. */
  end: number;
  allDay: boolean;
  /** `done` for a finished task — read by `e` to know it's reopening. */
  status?: string | null;
}

/** The draft's own ghost is a preview, not a block — never a row. */
export const DRAFT_PREVIEW_ID = "draft:preview";

/** One quarter hour: the grid's snap, and so its nudge. */
export const NUDGE_MINUTES = 15;

function instant(value: string, allDay: boolean): number {
  // An anytime row is a date, not an instant: `2026-10-15` is local midnight.
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDateISO(value).getTime();
  return new Date(value).getTime();
}

/** The grid's blocks in time order: earlier first, a day's anytime chips ahead of
 *  its timed blocks, then shorter first, then id — so ties never reshuffle. */
export function gridBlocks(inputs: readonly CalendarBlockInput[]): GridBlock[] {
  const blocks: GridBlock[] = [];
  for (const input of inputs) {
    if (input.id === DRAFT_PREVIEW_ID) continue;
    const props = (input.extendedProps ?? {}) as { kind?: string; refId?: string; done?: boolean };
    if (!props.refId) continue;
    const allDay = Boolean(input.allDay);
    const start = instant(input.start, allDay);
    if (Number.isNaN(start)) continue;
    const end = input.end ? instant(input.end, allDay) : allDay ? addDays(start, 1).getTime() : start;
    blocks.push({
      id: input.id,
      kind: props.kind === "task" ? "task" : props.kind === "slot" ? "slot" : "event",
      refId: props.refId,
      start,
      end: Math.max(end, start),
      allDay,
      status: props.kind === "task" ? (props.done ? "done" : "open") : null,
    });
  }
  return blocks.sort(
    (a, b) =>
      a.start - b.start ||
      Number(b.allDay) - Number(a.allDay) ||
      a.end - b.end ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Where j / k start when nothing is lit: the first block on screen that isn't
 *  over yet when now is on screen, else the first block on screen. */
export function homeBlockId(
  blocks: readonly GridBlock[],
  viewStart: number,
  viewEnd: number,
  now: number,
): string | null {
  const onScreen = blocks.filter((b) => b.start < viewEnd && b.end > viewStart);
  if (!onScreen.length) return null;
  if (now >= viewStart && now < viewEnd) {
    const next = onScreen.find((b) => !b.allDay && b.end > now);
    if (next) return next.id;
  }
  return onScreen[0].id;
}

export type BlockShift =
  | "earlier"
  | "later"
  | "shorter"
  | "longer"
  | "prevDay"
  | "nextDay";

/** Minutes past local midnight, stepped to the next quarter-hour line in `dir`. */
function stepToGrid(d: Date, dir: 1 | -1): Date {
  const mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const target =
    dir > 0
      ? (Math.floor(mins / NUDGE_MINUTES) + 1) * NUDGE_MINUTES
      : (Math.ceil(mins / NUDGE_MINUTES) - 1) * NUDGE_MINUTES;
  const next = new Date(d);
  // setHours carries past midnight either way, so 12:00am ⌥↑ is 11:45pm the
  // night before — the grid draws it there too.
  next.setHours(0, target, 0, 0);
  return next;
}

/**
 * Where a block goes for one press. A nudge lands on the quarter-hour grid (a
 * 9:10 block's first ⌥↓ is 9:15, not 9:25 — the grid you drag on is the grid
 * you nudge on); a resize moves only the end and never below a quarter hour; a
 * day keeps the clock (local, so a DST weekend doesn't shift it an hour).
 * An anytime block has no clock: only the day moves apply. Null = nothing to do.
 */
export function shiftSpan(
  span: { start: Date; end: Date; allDay?: boolean },
  how: BlockShift,
): { start: Date; end: Date } | null {
  const { start, end } = span;
  if (how === "prevDay" || how === "nextDay") {
    const by = how === "nextDay" ? 1 : -1;
    return { start: addDays(start, by), end: addDays(end, by) };
  }
  if (span.allDay) return null;
  if (how === "earlier" || how === "later") {
    const next = stepToGrid(start, how === "later" ? 1 : -1);
    const delta = next.getTime() - start.getTime();
    return { start: next, end: new Date(end.getTime() + delta) };
  }
  const nextEnd = stepToGrid(end, how === "longer" ? 1 : -1);
  const floor = start.getTime() + NUDGE_MINUTES * 60_000;
  const clamped = Math.max(nextEnd.getTime(), floor);
  if (clamped === end.getTime()) return null;
  return { start, end: new Date(clamped) };
}

/** The ⌥-arrow a key press means, or null. ⌥⇧↑/↓ resize; ⌥↑/↓ nudge; ⌥←/→ a day. */
export function shiftForKey(e: Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">): BlockShift | null {
  if (!e.altKey || e.metaKey || e.ctrlKey) return null;
  switch (e.key) {
    case "ArrowUp":
      return e.shiftKey ? "shorter" : "earlier";
    case "ArrowDown":
      return e.shiftKey ? "longer" : "later";
    case "ArrowLeft":
      return e.shiftKey ? null : "prevDay";
    case "ArrowRight":
      return e.shiftKey ? null : "nextDay";
  }
  return null;
}
