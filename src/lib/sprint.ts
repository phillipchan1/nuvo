// Sprint identity — the NUMBER that names a planning cycle. A sprint is one
// week, and its identity is the ISO week-of-year: Sprint 28 ≈ mid-July,
// self-locating and endless. Derived, never stored — pass a date, a
// 'YYYY-MM-DD' week_start, or any day in the week. See [[nuvo-push-aim-sprint]]:
// "sprint" is the cycle's ADD-ON identity that rides alongside "week" (the
// calendar canvas / Day·Week·Month zoom keeps that word).
//
// Anchor rule: the app shows Sunday-start weeks (calendar columns Sun→Sat, the
// On Deck timeline's Sunday weekStart), but callers also pass Monday week_starts
// and arbitrary mid-week dates. Numbering the RAW date breaks at the Sunday
// boundary (getISOWeek(Sunday) = the week it closes, off by one). So we snap to
// the Sunday-week's THURSDAY — ISO's week-defining day — which makes every
// surface (Schedule masthead, On Deck columns, Today, the ritual) agree.

import { addDays, differenceInCalendarWeeks, getISOWeek, getISOWeekYear, startOfWeek } from "date-fns";
import { parseDateISO } from "./dates";

function anchor(d: Date | string): Date {
  const date = typeof d === "string" ? parseDateISO(d) : d;
  return addDays(startOfWeek(date, { weekStartsOn: 0 }), 4);
}

/** The sprint's number = ISO week of year (1–53). */
export function sprintNumber(d: Date | string = new Date()): number {
  return getISOWeek(anchor(d));
}

/** The ISO week-year (can differ from calendar year around Jan 1 / Dec 31). */
export function sprintYear(d: Date | string = new Date()): number {
  return getISOWeekYear(anchor(d));
}

/** Whole sprints (weeks) from one date to another — robust across the year
 *  boundary (where sprint NUMBERS wrap 52→1). Positive = `to` is ahead of `from`.
 *  `sprintsBetween(now, target)` = sprints of runway left; a quarter's total =
 *  `sprintsBetween(qStart, qEnd) + 1`. */
export function sprintsBetween(from: Date | string, to: Date | string): number {
  return differenceInCalendarWeeks(anchor(to), anchor(from), { weekStartsOn: 1 });
}

/** "Sprint 28" — or "Sprint 28 · 2026" when the year matters (history, emblems,
 *  anywhere a number alone is ambiguous across years). */
export function sprintLabel(d: Date | string = new Date(), opts?: { year?: boolean }): string {
  const a = anchor(d);
  const n = getISOWeek(a);
  return opts?.year ? `Sprint ${n} · ${getISOWeekYear(a)}` : `Sprint ${n}`;
}
