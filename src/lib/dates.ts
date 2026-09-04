import { addDays, format, startOfWeek } from "date-fns";
import { planningWeekStart } from "../../supabase/functions/_shared/planningRules.ts";
import { isOverdue as kernelIsOverdue } from "../../supabase/functions/_shared/taskQuery.ts";

export const APP_TZ = "America/Los_Angeles";

/** Current date in the app timezone as 'YYYY-MM-DD'. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function toDateISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function tomorrowISO(): string {
  return toDateISO(addDays(parseDateISO(todayISO()), 1));
}

/** Next Monday (start of next week, week starts Monday). */
export function nextWeekISO(): string {
  const today = parseDateISO(todayISO());
  const monday = startOfWeek(addDays(today, 7), { weekStartsOn: 1 });
  return toDateISO(monday);
}

/**
 * Monday of the *planning* week as 'YYYY-MM-DD', computed from the APP_TZ
 * calendar (not the machine clock). The work-week (Mon–Fri) plans the week
 * it's living; the weekend points forward — Sat/Sun "the week" means the one
 * about to start, so the Plan flow opens on it and the rail's funnel follows.
 */
export function planningWeekStartISO(now: Date = new Date()): string {
  // The rule itself lives in the planning kernel — the agent plans from the same
  // one. (It used to be written twice, and the two disagreed about Saturday.)
  return planningWeekStart(todayISO(now));
}

/** A week's span in one label: "Aug 10 – 16", or "Jul 27 – Aug 2" across a month
 *  boundary. Written three times (the rail crown, the phone's week card, the
 *  Week's Plan sheet) before it lived here. */
export function weekRangeLabel(weekStartISO: string): string {
  const s = parseDateISO(weekStartISO);
  const e = addDays(s, 6);
  return `${format(s, "MMM d")} – ${format(e, s.getMonth() === e.getMonth() ? "d" : "MMM d")}`;
}

/** Hours from minutes, max one decimal: 90 → "1.5", 120 → "2". */
export function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1);
}

/** Parse 'YYYY-MM-DD' into a local-midnight Date (for date-fns math/format). */
export function parseDateISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Snap a date's minutes to the nearest `step` (default 15). */
export function snapMinutes(d: Date, step = 15): Date {
  const out = new Date(d);
  out.setMinutes(Math.round(out.getMinutes() / step) * step, 0, 0);
  return out;
}

export function endOf(task: { start_time: string; duration_minutes: number | null }): Date {
  const start = new Date(task.start_time);
  return new Date(start.getTime() + (task.duration_minutes ?? 30) * 60_000);
}

/**
 * Instant FullCalendar will not treat as a date-only (midnight) start.
 *
 * Postgres/PostgREST sometimes yield `"2026-09-03 23:00:00+00"` (space, no `T`).
 * FullCalendar's parser then marks the time unspecified, and a timed `end`
 * makes allDay infer false — a block from local midnight to the real end,
 * painted as a column-tall overlay next to the drop ghost. Always hand it `Z`.
 *
 * Safari/WKWebView (the desktop app) rejects the space form; rewrite it first.
 */
export function toFcInstant(iso: string): string {
  const tryParse = (s: string): string | null => {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const direct = tryParse(iso);
  if (direct) return direct;
  const withT = iso.trim().replace(" ", "T");
  const viaT = tryParse(withT);
  if (viaT) return viaT;
  const withColonOffset = withT.replace(/([+-]\d{2})$/, "$1:00");
  return tryParse(withColonOffset) ?? iso;
}

/**
 * A scheduled task turns overdue 1 hour after its end time — and a task whose
 * `do_date` has already passed is overdue too.
 *
 * The rule itself lives in the shared kernel (`_shared/taskQuery.ts`), not
 * here: the task filter has to ask the same question, and two definitions would
 * have put two meanings of "Overdue" in one panel (P11) — the rail's section
 * counting a block that ran long, the filter beside it counting a stale date.
 * This is only the adapter that keeps every existing call site, which passes a
 * `Date`, working unchanged.
 */
export function isOverdue(
  task: { start_time: string | null; duration_minutes: number | null; do_date?: string | null; status?: string },
  now: Date = new Date(),
): boolean {
  return kernelIsOverdue(task, now.getTime(), todayISO(now));
}

/** How late a scheduled task is, phrased as a span rather than a clock time.
 *  "2d late" answers *how far gone is this* — which is the decision you actually
 *  make about slipped work; "10:45 AM" makes you do the subtraction yourself.
 *  Measured from the block's END, the same anchor `isOverdue` uses, so the label
 *  can never read "0m late" on a row this file already calls overdue. Coarse on
 *  purpose: past an hour, the exact minute is noise. */
export function fmtLateness(
  task: { start_time: string | null; duration_minutes: number | null },
  now: Date = new Date(),
): string | null {
  if (!task.start_time) return null;
  const end = endOf({ start_time: task.start_time, duration_minutes: task.duration_minutes });
  const mins = Math.floor((now.getTime() - end.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m late`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h late`;
  return `${Math.floor(hrs / 24)}d late`;
}

export function fmtTime(iso: string): string {
  return format(new Date(iso), "h:mm a");
}

/** "Thu 9am" · "Thu 9:30am" — a block's day and start in one glance. The same
 *  idiom `whenText` and `FindTimeProposal` use, so a proposed block, a placed
 *  one and the week crown's disclosure all read alike on both shells. */
export function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  const hh = ((h + 11) % 12) + 1;
  return `${format(d, "EEE")} ${m === 0 ? `${hh}${ampm}` : `${hh}:${String(m).padStart(2, "0")}${ampm}`}`;
}

/** Hour 0–23, or 24 for midnight end-of-day. */
export function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "12:00 AM";
  if (hour === 12) return "12:00 PM";
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

export function fmtDuration(minutes: number | null | undefined): string {
  const m = minutes ?? 30;
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`;
}

export function fmtDayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === tomorrowISO()) return "Tomorrow";
  return format(parseDateISO(iso), "EEE MMM d");
}

/** Local calendar date as YYYY-MM-DD from an ISO timestamp. */
export function dateISOFromInstant(iso: string): string {
  return toDateISO(new Date(iso));
}

/** Local midnight for a calendar day. */
export function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** All-day events span whole calendar days; provider end dates are exclusive. */
export function allDayRangeFromStart(startDay: Date, inclusiveEndDay?: Date): { start_at: string; end_at: string } {
  const start = localMidnight(startDay);
  const last = localMidnight(inclusiveEndDay && inclusiveEndDay >= startDay ? inclusiveEndDay : startDay);
  return { start_at: start.toISOString(), end_at: addDays(last, 1).toISOString() };
}

/** Inclusive last day for an all-day event whose stored end_at is exclusive. */
export function allDayInclusiveEnd(isoEnd: string): Date {
  return addDays(localMidnight(new Date(isoEnd)), -1);
}

/** Default timed block when flipping an all-day event to a specific time. */
export function defaultTimedRange(day: Date): { start_at: string; end_at: string } {
  const start = localMidnight(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return { start_at: start.toISOString(), end_at: end.toISOString() };
}
