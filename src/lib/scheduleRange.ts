/**
 * The desktop Schedule's fetch ranges — what FullCalendar will report through
 * `datesSet`, computed before it does.
 *
 * The Schedule fetches exactly the span it draws, keyed on FullCalendar's own
 * ISO bounds. So to make ‹ › instant, the neighbours have to be warmed under
 * the SAME keys, to the millisecond: a range an hour off (a naive `+ 7 * 86400000`
 * across a DST change) pays for a fetch, misses, and pays again, and looks
 * exactly like no prefetch at all. Hence local calendar-day arithmetic, and
 * FullCalendar's defaults spelled out: local time zone, seven-day weeks, and a
 * month grid of a fixed six weeks (`fixedWeekCount`).
 *
 * The phone doesn't use this — its lenses fetch windows wider than they draw
 * (`calendarRange` in `mobile/MobileCalendar.tsx`). The desktop deliberately
 * doesn't widen: every fetched event goes through FullCalendar's reconcile, so
 * a wider window is a slower grid on every change, not just on travel.
 */
import { addDays, addMonths, differenceInCalendarDays, startOfDay, startOfMonth, startOfWeek } from "date-fns";

export interface ScheduleRange {
  start: string;
  end: string;
}

type WeekStart = 0 | 1;

/** dayGridMonth: six weeks from the week holding the 1st. */
function monthGrid(month: Date, weekStartsOn: WeekStart): ScheduleRange {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn });
  return { start: start.toISOString(), end: addDays(start, 42).toISOString() };
}

/** The range FullCalendar draws for a view standing on `date`. Anything that
 *  isn't a day or month grid (the week, and the non-FC Board and Year, which
 *  still need *a* range to key on) is the week. */
export function scheduleRangeFor(view: string, date: Date, weekStartsOn: WeekStart): ScheduleRange {
  if (view === "dayGridMonth") return monthGrid(date, weekStartsOn);
  if (view === "timeGridDay") {
    const d = startOfDay(date);
    return { start: d.toISOString(), end: addDays(d, 1).toISOString() };
  }
  const wk = startOfWeek(startOfDay(date), { weekStartsOn });
  return { start: wk.toISOString(), end: addDays(wk, 7).toISOString() };
}

/**
 * The ranges `steps` presses of ‹ › away from `range`. Read off the range
 * itself rather than the view, so it can never disagree with what is actually
 * on screen — the view flips a render before `datesSet` reports its new span.
 * A span of up to a week steps by its own length; anything longer is a month
 * grid, which steps by a month.
 */
export function scheduleNeighbours(
  range: ScheduleRange,
  weekStartsOn: WeekStart,
  steps: number[],
): ScheduleRange[] {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const days = differenceInCalendarDays(end, start);
  if (days > 7) {
    // Mid-grid is always inside the drawn month; the grid's first row
    // usually isn't.
    const month = startOfMonth(addDays(start, 15));
    return steps.map((n) => monthGrid(addMonths(month, n), weekStartsOn));
  }
  return steps.map((n) => ({
    start: addDays(start, n * days).toISOString(),
    end: addDays(end, n * days).toISOString(),
  }));
}
