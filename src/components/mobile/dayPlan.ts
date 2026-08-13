// The one place a mobile calendar date becomes a plan — shared by the month
// grid (free/busy density), the schedule agenda (the full read) and the Day
// lens (the proportional canvas), so "what counts as busy" and "what is open"
// live once (readDay / toBusyBlocks under the hood). Extracted from
// MobileCalendar.tsx so the lenses can share it without an import cycle.

import { addDays, isSameDay, startOfDay } from "date-fns";
import { readDay, toBusyBlocks, type Gap } from "../../lib/now";
import { dayReadout as sharedDayReadout } from "../../../supabase/functions/_shared/dayShape.ts";
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
  accountId?: string;
  calendarId?: string;
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

// Per-ctx day index. Every caller builds plans for a whole span (21 agenda
// days, 42 month cells), and the naive shape re-filtered EVERY event and block
// — with fresh Date allocations per row — once per day: at a real data volume
// (1,400+ events) that was ~120ms of self time on a single tab switch. The
// buckets are built once per ctx identity (the callers already memoize ctx)
// and the WeakMap keeps this invisible to call sites.
interface SpanningEvent {
  e: ExternalEvent;
  start: number;
  end: number;
}
interface DayIndex {
  allDay: SpanningEvent[];
  eventsByDay: Map<string, ExternalEvent[]>;
  blocksByDay: Map<string, Task[]>;
}
const dayIndexCache = new WeakMap<DayCtx, DayIndex>();

function indexOf(ctx: DayCtx): DayIndex {
  const cached = dayIndexCache.get(ctx);
  if (cached) return cached;
  const allDay: SpanningEvent[] = [];
  const eventsByDay = new Map<string, ExternalEvent[]>();
  for (const e of ctx.visibleEvents) {
    if (e.all_day) {
      // All-day events span days, so they stay a list — but with the dates
      // parsed once instead of twice per event per day.
      allDay.push({ e, start: new Date(e.start_at).getTime(), end: new Date(e.end_at).getTime() });
    } else {
      const k = dayKey(new Date(e.start_at));
      const arr = eventsByDay.get(k);
      if (arr) arr.push(e);
      else eventsByDay.set(k, [e]);
    }
  }
  const blocksByDay = new Map<string, Task[]>();
  for (const t of ctx.blocks) {
    if (!t.start_time) continue;
    const k = dayKey(new Date(t.start_time));
    const arr = blocksByDay.get(k);
    if (arr) arr.push(t);
    else blocksByDay.set(k, [t]);
  }
  const idx = { allDay, eventsByDay, blocksByDay };
  dayIndexCache.set(ctx, idx);
  return idx;
}

// The one place a calendar date becomes a plan — used by the month grid (for
// its free/busy density), the schedule agenda (the full read) and the Day lens.
export function buildDayPlan(date: Date, ctx: DayCtx): DayPlan {
  const { hidden, workStart, workEnd, now } = ctx;
  const idx = indexOf(ctx);
  const dStart = startOfDay(date);
  const dEnd = new Date(dStart.getTime() + DAY_MS);
  const startNow = startOfDay(now);
  const isToday = isSameDay(date, now);
  const isBygone = dStart.getTime() < startNow.getTime();

  const allDay = idx.allDay
    .filter((p) => p.start < dEnd.getTime() && p.end > dStart.getTime())
    .map((p) => p.e);

  const dayEvents = idx.eventsByDay.get(dayKey(date)) ?? [];
  const dayBlocks = idx.blocksByDay.get(dayKey(date)) ?? [];
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
      accountId: e.account_id,
      calendarId: e.calendar_id,
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
/** The words a day is described in. The rule lives in the shared day-shape
 *  kernel so the phone, the desk and a watch that can't import `src/` all say
 *  the same thing about the same day; this is only the adapter from `DayPlan`. */
export function dayReadout(day: DayPlan): { text: string; accent: boolean } {
  return sharedDayReadout({
    busyCount: day.timed.length + day.allDay.length,
    openMins: day.openMins,
    isPast: day.isPast,
    isBygone: day.isBygone,
  });
}
