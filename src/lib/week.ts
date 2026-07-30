// Week identity — how a planning week NAMES itself.
//
// A week is the gate (Principle 2), and the name it wears depends on DISTANCE:
// the weeks you actually plan read relatively ("This week", "Next week", "In 3
// weeks"); everything further out is anchored to a real date ("Week of Aug 24").
//
// The ISO week NUMBER is still derived here — spans, runway and cross-year
// identity need it — but it is never a headline (D-058). US readers don't carry
// an ISO week↔date mapping; both Google and Apple ship week numbers off by
// default, and Google's mobile apps don't offer them at all. The number was also
// never doing the work: every surface that printed "Sprint 33" already printed
// "This week · Aug 10" underneath it.
//
// Anchor rule: the app shows Sunday-start weeks (calendar columns Sun→Sat, the
// On Deck timeline's Sunday weekStart), but callers also pass Monday week_starts
// and arbitrary mid-week dates. Numbering the RAW date breaks at the Sunday
// boundary (getISOWeek(Sunday) = the week it closes, off by one). So we snap to
// the Sunday-week's THURSDAY — ISO's week-defining day — which makes every
// surface (Schedule masthead, On Deck columns, Today, the ritual) agree.

import { addDays, differenceInCalendarWeeks, format, getISOWeek, getISOWeekYear, startOfWeek } from "date-fns";
import { parseDateISO } from "./dates";

const asDate = (d: Date | string): Date => (typeof d === "string" ? parseDateISO(d) : d);

function anchor(d: Date | string): Date {
  return addDays(startOfWeek(asDate(d), { weekStartsOn: 0 }), 4);
}

/** The first day of the week a date belongs to, in the caller's own convention:
 *  hand us a Sunday or a Monday and we take it as the week start you meant (the
 *  planning week is Monday, the Schedule grid is Sunday — both are legitimate
 *  and both reach these labels). Anything mid-week snaps to its Sunday. */
function weekStartOf(d: Date | string): Date {
  const date = asDate(d);
  const dow = date.getDay();
  return dow === 0 || dow === 1 ? date : startOfWeek(date, { weekStartsOn: 0 });
}

/** ISO week of year (1–53). An identity for storage, history and cross-year
 *  references — not a label. Use `weekName` for anything a person reads. */
export function weekNumber(d: Date | string = new Date()): number {
  return getISOWeek(anchor(d));
}

/** The ISO week-year (can differ from calendar year around Jan 1 / Dec 31). */
export function weekYear(d: Date | string = new Date()): number {
  return getISOWeekYear(anchor(d));
}

/** Whole weeks from one date to another — robust across the year boundary.
 *  Positive = `to` is ahead of `from`. `weeksBetween(now, target)` = weeks of
 *  runway left; a quarter's total = `weeksBetween(qStart, qEnd) + 1`. */
export function weeksBetween(from: Date | string, to: Date | string): number {
  return differenceInCalendarWeeks(anchor(to), anchor(from), { weekStartsOn: 1 });
}

/** The front door: "This week" · "Next week" · "Last week" · "In 3 weeks" ·
 *  "3 weeks ago" · "Week of Aug 24". Relative while relative still locates you,
 *  dated after that — never a number.
 *  `within` caps the relative voice (default 4, the planning horizon). */
export function weekName(
  d: Date | string = new Date(),
  opts?: { ref?: Date | string; within?: number },
): string {
  const n = weeksBetween(opts?.ref ?? new Date(), d);
  const within = opts?.within ?? 4;
  if (n === 0) return "This week";
  if (n === 1) return "Next week";
  if (n === -1) return "Last week";
  if (n > 1 && n <= within) return `In ${n} weeks`;
  if (n < -1 && -n <= within) return `${-n} weeks ago`;
  return `Week of ${format(weekStartOf(d), "MMM d")}`;
}

/** "Aug 10–16", or "Aug 31–Sep 6" when the week crosses a month. The date line
 *  that rides under `weekName` — this is what actually locates a reader. */
export function weekSpan(d: Date | string = new Date()): string {
  const s = weekStartOf(d);
  const e = addDays(s, 6);
  const m = format(s, "MMM");
  return m === format(e, "MMM")
    ? `${m} ${format(s, "d")}–${format(e, "d")}`
    : `${format(s, "MMM d")}–${format(e, "MMM d")}`;
}

/** The compact form for a pager chip or a scale tick, where "In 3 weeks" won't
 *  fit: "Now" · "Next" · "+2" · "−1" · "Aug 24" once it's off the horizon. */
export function weekTick(
  d: Date | string = new Date(),
  opts?: { ref?: Date | string; within?: number },
): string {
  const n = weeksBetween(opts?.ref ?? new Date(), d);
  const within = opts?.within ?? 4;
  if (n === 0) return "Now";
  if (n === 1) return "Next";
  if (n > 1 && n <= within) return `+${n}`;
  if (n < 0 && -n <= within) return `−${-n}`;
  return format(weekStartOf(d), "MMM d");
}
