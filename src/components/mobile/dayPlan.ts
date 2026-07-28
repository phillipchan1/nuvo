// The one place a mobile calendar date becomes a plan — shared by the month
// grid (free/busy density), the schedule agenda (the full read) and the Day
// lens (the proportional canvas), so "what counts as busy" and "what is open"
// live once (readDay / toBusyBlocks under the hood). Extracted from
// MobileCalendar.tsx so the lenses can share it without an import cycle.

import { addDays, isSameDay, startOfDay } from "date-fns";
import { fmtMins, readDay, toBusyBlocks, type Gap } from "../../lib/now";
import type { AttendeeStatus, ExternalEvent, Task } from "../../lib/types";

export const DAY_MS = 24 * 3600_000;

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export const at = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// The mobile calendar renders inside the shell's <main> scroller, not its own.
// WebKit (iOS PWA + Tauri WKWebView) has no `overflow-anchor`, so when a lens
// adds content above the viewport it has to correct scrollTop by hand — this
// finds the element that actually scrolls so it can be measured and adjusted.
// Matched by overflow style alone (not current scrollability): during a loading
// placeholder the content isn't tall enough to overflow yet, but we still need
// the scroller to attach listeners and land the anchor once data arrives.
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement ?? null;
  while (n) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return n;
    n = n.parentElement;
  }
  return null;
}

export interface TimedItem {
  title: string;
  start: Date;
  end: Date;
  kind: "event" | "block";
  location?: string | null;
  done?: boolean;
  // For tapping:
  eventId?: string;
  self_rsvp?: AttendeeStatus | null;
  taskId?: string;
  /** Project-backed block — renders as a "project slot" (significant work). */
  projectBacked?: boolean;
}

export interface DayPlan {
  date: Date;
  isToday: boolean;
  label: string; // "Today" / "Tomorrow" / weekday
  allDay: ExternalEvent[];
  timed: TimedItem[];
  gaps: Gap[];
  openMins: number;
  isPast: boolean; // a fully-elapsed work window (today, after hours)
  isBygone: boolean; // a calendar date strictly before today — a historical read
}

export interface DayCtx {
  visibleEvents: ExternalEvent[];
  blocks: Task[];
  hidden: Set<string>;
  workStart: number;
  workEnd: number;
  now: Date;
}

// The one place a calendar date becomes a plan — used by the month grid (for
// its free/busy density), the schedule agenda (the full read) and the Day lens.
export function buildDayPlan(date: Date, ctx: DayCtx): DayPlan {
  const { visibleEvents, blocks, hidden, workStart, workEnd, now } = ctx;
  const dStart = startOfDay(date);
  const dEnd = new Date(dStart.getTime() + DAY_MS);
  const startNow = startOfDay(now);
  const isToday = isSameDay(date, now);
  const isBygone = dStart.getTime() < startNow.getTime();

  const allDay = visibleEvents.filter(
    (e) => e.all_day && new Date(e.start_at) < dEnd && new Date(e.end_at) > dStart,
  );

  const dayEvents = visibleEvents.filter((e) => !e.all_day && dayKey(new Date(e.start_at)) === dayKey(date));
  const dayBlocks = blocks.filter((t: Task) => t.start_time && dayKey(new Date(t.start_time)) === dayKey(date));
  const busy = toBusyBlocks(dayEvents, dayBlocks, hidden);

  const ws = new Date(dStart);
  ws.setHours(0, workStart, 0, 0);
  const we = new Date(dStart);
  we.setHours(0, workEnd, 0, 0);
  const refNow = isToday ? new Date(Math.max(now.getTime(), ws.getTime())) : ws;
  const read = readDay(refNow, busy, ws, we);

  const timed: TimedItem[] = [
    ...dayEvents.filter((e) => e.busy).map((e) => ({
      title: e.title,
      start: new Date(e.start_at),
      end: new Date(e.end_at),
      kind: "event" as const,
      location: e.location,
      done: false,
      eventId: e.id,
      self_rsvp: e.self_rsvp ?? null,
    })),
    ...dayBlocks
      .filter((t: Task) => t.start_time)
      .map((t: Task) => ({
        title: t.title,
        start: new Date(t.start_time!),
        end: new Date(new Date(t.start_time!).getTime() + (t.duration_minutes ?? 30) * 60_000),
        kind: "block" as const,
        location: null,
        done: t.status === "done",
        taskId: t.id,
        self_rsvp: null,
        projectBacked: !!t.project_id,
      })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  const label = isToday
    ? "Today"
    : isSameDay(date, addDays(startNow, 1))
      ? "Tomorrow"
      : isSameDay(date, addDays(startNow, -1))
        ? "Yesterday"
        : date.toLocaleDateString([], { weekday: "long" });

  return {
    date,
    isToday,
    label,
    allDay,
    timed,
    gaps: read.gaps,
    openMins: read.openMins,
    isPast: isToday && now.getTime() >= we.getTime(),
    isBygone,
  };
}

/** The day's one-line availability answer — shared by the agenda's day header
 *  and the Day lens header, so the two lenses can't disagree about a day. A
 *  past date is a record of what happened, not an availability question — its
 *  readout counts commitments and never advertises open windows. */
export function dayReadout(day: DayPlan): { text: string; accent: boolean } {
  const busyCount = day.timed.length + day.allDay.length;
  const text = day.isBygone
    ? busyCount > 0
      ? `${busyCount} scheduled`
      : ""
    : day.isPast
      ? "done for today"
      : day.openMins > 0
        ? `${fmtMins(day.openMins)} open`
        : busyCount > 0
          ? "fully booked"
          : "wide open";
  return { text, accent: !day.isBygone && !day.isPast && day.openMins > 0 };
}
