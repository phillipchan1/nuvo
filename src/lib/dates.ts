import { addDays, format, startOfWeek } from "date-fns";

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
 * calendar (not the machine clock). On Sundays this is tomorrow's Monday —
 * Sunday evening plans the week ahead, not the week that's ending.
 */
export function planningWeekStartISO(now: Date = new Date()): string {
  const laToday = parseDateISO(todayISO(now));
  const base = laToday.getDay() === 0 ? addDays(laToday, 1) : laToday;
  return toDateISO(startOfWeek(base, { weekStartsOn: 1 }));
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

/** A scheduled task turns overdue 1 hour after its end time. */
export function isOverdue(
  task: { start_time: string | null; duration_minutes: number | null },
  now: Date = new Date(),
): boolean {
  if (!task.start_time) return false;
  const end = endOf({ start_time: task.start_time, duration_minutes: task.duration_minutes });
  return now.getTime() > end.getTime() + 60 * 60_000;
}

export function fmtTime(iso: string): string {
  return format(new Date(iso), "h:mm a");
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
