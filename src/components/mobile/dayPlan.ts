// The one place a mobile calendar date becomes a plan — shared by the month
// grid (free/busy density), the schedule agenda (the full read) and the Day
// lens (the proportional canvas), so "what counts as busy" and "what is open"
// live once (readDay / toBusyBlocks under the hood). Extracted from
// MobileCalendar.tsx so the lenses can share it without an import cycle.

import { addDays, isSameDay, startOfDay } from "date-fns";
import { readDay, toBusyBlocks, type BusyBlock, type Gap } from "../../lib/now";
import {
  dayLoad as sharedDayLoad,
  dayReadout as sharedDayReadout,
  type DayLoad,
} from "../../../supabase/functions/_shared/dayShape.ts";
import type { AttendeeStatus, ExternalEvent, Slot, Task } from "../../lib/types";

export type { DayLoad };

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
  kind: "event" | "block" | "slot";
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
  /** kind === "slot" only — the raw row (for the tap payload / slot actions)
   *  plus how many of its children are done, for the sheet + a compact count. */
  slot?: Slot;
  childCount?: number;
  doneCount?: number;
  /** kind === "slot" only — the "what's in there" peek, done sunk to the
   *  bottom, same order desktop's CalendarPane shows inside the container. */
  children?: { title: string; done: boolean }[];
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
  /** How heavy the day is, from the shared kernel — the same band the Year grid
   *  shades with. Carried here so no surface has to weigh a day itself. */
  load: DayLoad;
}

export interface DayCtx {
  visibleEvents: ExternalEvent[];
  blocks: Task[];
  /** Standing slots — a slot is a timed container; a task placed inside one
   *  loses its own start_time and rides the slot's (see assignToSlot in
   *  useTasks.ts), so a slot has to be fetched and rendered separately from
   *  `blocks` or its contents are invisible on the calendar. */
  slots: Slot[];
  /** slot.id -> its child tasks (unfiltered; buildDayPlan drops trashed ones). */
  slotChildren: Record<string, Task[]>;
  /** slot.id -> display title, pre-derived by the caller via deriveSlotTitle
   *  (lib/slots.ts) so mobile and desktop agree on what a slot is called —
   *  that derivation needs VerticalData, which stays out of this pure module. */
  slotTitles: Map<string, string>;
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
  slotsByDay: Map<string, Slot[]>;
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
  const slotsByDay = new Map<string, Slot[]>();
  for (const s of ctx.slots) {
    const k = dayKey(new Date(s.start_time));
    const arr = slotsByDay.get(k);
    if (arr) arr.push(s);
    else slotsByDay.set(k, [s]);
  }
  const idx = { allDay, eventsByDay, blocksByDay, slotsByDay };
  dayIndexCache.set(ctx, idx);
  return idx;
}

/** Everything a day is made of, before anyone decides what to do with it —
 *  which rows fall on it, what they claim, and where its working window sits.
 *
 *  Extracted so `buildDayPlan` (the full read) and `buildDayLoad` (the year's
 *  cheap one) share it. A second copy here would be the same class of bug as a
 *  second `toBusyBlocks`: the year would shade a Tuesday the Day lens draws
 *  differently, and neither would look wrong on its own. */
function dayFrame(date: Date, ctx: DayCtx) {
  const { hidden, workStart, workEnd } = ctx;
  const idx = indexOf(ctx);
  const dStart = startOfDay(date);
  const dEnd = new Date(dStart.getTime() + DAY_MS);

  const allDay = idx.allDay
    .filter((p) => p.start < dEnd.getTime() && p.end > dStart.getTime())
    .map((p) => p.e);

  const dayEvents = idx.eventsByDay.get(dayKey(date)) ?? [];
  const dayBlocks = idx.blocksByDay.get(dayKey(date)) ?? [];
  const daySlots = idx.slotsByDay.get(dayKey(date)) ?? [];
  const busy = toBusyBlocks(dayEvents, dayBlocks, hidden);
  // A slot occupies real time on the day even though its children carry no
  // start_time of their own (the slot owns the block, see DayCtx.slots) — fold
  // it into the same busy list toBusyBlocks builds, or the gap math below would
  // draw an "open" window right on top of the slot it just rendered.
  for (const s of daySlots) {
    const children = (ctx.slotChildren[s.id] ?? []).filter((t) => t.status !== "trashed");
    const start = new Date(s.start_time);
    const end: Date = new Date(start.getTime() + s.duration_minutes * 60_000);
    busy.push({
      title: ctx.slotTitles.get(s.id) ?? s.title ?? "Block",
      start,
      end,
      kind: "block",
      done: children.length > 0 && children.every((t) => t.status === "done"),
    } satisfies BusyBlock);
  }

  const ws = new Date(dStart);
  ws.setHours(0, workStart, 0, 0);
  const we = new Date(dStart);
  we.setHours(0, workEnd, 0, 0);

  return { dStart, dEnd, allDay, dayEvents, dayBlocks, daySlots, busy, ws, we };
}

/** The kernel's load band for a day, from the frame's own busy list. The
 *  yardstick is the user's working window; the claim is every busy interval on
 *  the day, evening ones included. See `dayLoad` in `_shared/dayShape.ts`. */
function loadOf(frame: ReturnType<typeof dayFrame>): DayLoad {
  return sharedDayLoad(
    frame.busy.map((b) => ({ startMs: b.start.getTime(), endMs: b.end.getTime() })),
    frame.ws.getTime(),
    frame.we.getTime(),
    frame.busy.length + frame.allDay.length,
  );
}

/**
 * A day's load and nothing else — what a year grid reads, 365 times.
 *
 * The full `buildDayPlan` allocates a `TimedItem` (and several `Date`s) per row
 * and walks the gap math; a year of that is work nobody looks at, since a 3mm
 * square shows a shade, not a schedule. This shares the frame, so it is the
 * same answer, just without building the parts the square can't show.
 */
export function buildDayLoad(date: Date, ctx: DayCtx): DayLoad {
  return loadOf(dayFrame(date, ctx));
}

// The one place a calendar date becomes a plan — used by the month grid (for
// its free/busy density), the schedule agenda (the full read) and the Day lens.
export function buildDayPlan(date: Date, ctx: DayCtx): DayPlan {
  const { now } = ctx;
  const frame = dayFrame(date, ctx);
  const { dStart, allDay, dayEvents, dayBlocks, daySlots, busy, ws, we } = frame;
  const startNow = startOfDay(now);
  const isToday = isSameDay(date, now);
  const isBygone = dStart.getTime() < startNow.getTime();

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
    ...daySlots.map((s): TimedItem => {
      const rawChildren = (ctx.slotChildren[s.id] ?? []).filter((t) => t.status !== "trashed");
      const doneCount = rawChildren.filter((t) => t.status === "done").length;
      const start = new Date(s.start_time);
      // completed tasks sink to the bottom — same order the desktop container shows.
      const children = rawChildren
        .map((t) => ({ title: t.title, done: t.status === "done" }))
        .sort((a, b) => Number(a.done) - Number(b.done));
      return {
        title: ctx.slotTitles.get(s.id) ?? s.title ?? "Block",
        start,
        end: new Date(start.getTime() + s.duration_minutes * 60_000),
        kind: "slot",
        location: null,
        done: rawChildren.length > 0 && doneCount === rawChildren.length,
        self_rsvp: null,
        projectBacked: !!s.project_id,
        slot: s,
        childCount: rawChildren.length,
        doneCount,
        children,
      };
    }),
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
    load: loadOf(frame),
  };
}

// ── Laying a day's commitments out in columns ───────────────────────────────

export interface Laid {
  item: TimedItem;
  startMin: number; // wall-clock minutes into the day, clamped [0,1440]
  endMin: number;
  col: number;
  cols: number;
}

/** Overlap packing — the classic day-grid algorithm: sort by start (longer
 *  first on ties), walk runs of transitively-overlapping items, give each the
 *  first free column, and let every member of a run share its column count.
 *
 *  Lives here rather than in a lens because the Day grid and the Week grid draw
 *  the same day and must pack it identically — two copies is how one lens
 *  starts showing an overlap the other hides. */
export function layoutDay(items: TimedItem[], date: Date): Laid[] {
  const dk = dayKey(date);
  const mins = (d: Date, edge: 0 | 1440) => (dayKey(d) === dk ? d.getHours() * 60 + d.getMinutes() : edge);
  const laid: Laid[] = items.map((item) => {
    const startMin = mins(item.start, 0);
    return { item, startMin, endMin: Math.max(mins(item.end, 1440), startMin + 1), col: 0, cols: 1 };
  });
  laid.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  let cluster: Laid[] = [];
  let colEnds: number[] = [];
  let clusterMax = -1;
  const flush = () => {
    for (const l of cluster) l.cols = colEnds.length;
    cluster = [];
    colEnds = [];
    clusterMax = -1;
  };
  for (const l of laid) {
    if (cluster.length && l.startMin >= clusterMax) flush();
    let col = colEnds.findIndex((e) => e <= l.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(l.endMin);
    } else {
      colEnds[col] = Math.max(colEnds[col], l.endMin);
    }
    l.col = col;
    cluster.push(l);
    clusterMax = Math.max(clusterMax, l.endMin);
  }
  flush();
  return laid;
}

/** The tap payload for a laid-out item — one mapping, so the Day grid, the
 *  Week grid and the agenda all hand the sheet the same shape. */
export function tapFor(b: TimedItem): CalendarTapLike {
  return b.kind === "event"
    ? {
        kind: "event",
        id: b.eventId!,
        title: b.title || "Untitled",
        start: b.start,
        end: b.end,
        location: b.location ?? null,
        self_rsvp: b.self_rsvp,
        accountId: b.accountId,
        calendarId: b.calendarId,
      }
    : b.kind === "slot"
      ? {
          kind: "slot",
          slot: b.slot!,
          title: b.title || "Untitled",
          start: b.start,
          end: b.end,
          childCount: b.childCount ?? 0,
          doneCount: b.doneCount ?? 0,
        }
      : { kind: "block", taskId: b.taskId!, title: b.title || "Untitled", start: b.start, end: b.end, done: !!b.done };
}

/** Structurally the `CalendarTap` union from MobileEventSheet. Restated here
 *  rather than imported because that module pulls in React — and this one is
 *  deliberately importable from anywhere, including the desktop. */
type CalendarTapLike =
  | {
      kind: "event";
      id: string;
      title: string;
      start: Date;
      end: Date;
      location: string | null;
      self_rsvp?: AttendeeStatus | null;
      accountId?: string;
      calendarId?: string;
    }
  | { kind: "slot"; slot: Slot; title: string; start: Date; end: Date; childCount: number; doneCount: number }
  | { kind: "block"; taskId: string; title: string; start: Date; end: Date; done: boolean };

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
