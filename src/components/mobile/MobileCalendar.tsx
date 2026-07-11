import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useSettings } from "../../hooks/useSettings";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks } from "../../hooks/useTasks";
import { fmtMins, isEventHidden, readDay, toBusyBlocks, type Gap } from "../../lib/now";
import type { AttendeeStatus, ExternalEvent, Task } from "../../lib/types";
import type { CalendarTap } from "./MobileEventSheet";
import { useWeather, indexWeather } from "../../hooks/useWeather";
import WeatherIcon from "../WeatherIcon";

// The mobile Calendar — two lenses on the same live day-shape math:
//   • Month — the whole month at a glance (free/busy density per day), swipe or
//     arrow between months, tap any day to drop into its schedule.
//   • Schedule — a 14-day agenda from the selected day, where each day shows its
//     commitments AND its open windows, computed by the same readDay() Now uses.
// Both read from one buildDayPlan(), so "what counts as busy" lives in one place.

const HORIZON_DAYS = 14;
// The schedule is bidirectional: it loads history *behind* the anchor so you can
// scroll up into the past (the default land is on the anchor day, with these days
// already sitting above it), and reveals more in PAST_STEP chunks on demand.
const PAST_WINDOW = 14; // days of history preloaded behind the anchor
const PAST_STEP = 14; // how many more the "earlier" control reveals per tap
// Where a pinned day sits below the two sticky bars (back header + date strip).
// Matches the DayCard's scroll-mt so tap-to-jump and the scroll pin agree.
const STICKY_OFFSET = 112;
const DAY_MS = 24 * 3600_000;
const SWIPE_PX = 48; // horizontal travel that counts as a month swipe
// Monday-start weeks, matching the app's planning week (see dates.ts).
const WEEK_OPTS = { weekStartsOn: 1 as const };
const MODE_KEY = "nuvo-mobile-cal-mode";

type Mode = "month" | "schedule";

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const at = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// The schedule renders inside the shell's <main> scroller, not its own. WebKit
// (iOS PWA + Tauri WKWebView) has no `overflow-anchor`, so when we add days above
// the viewport we have to correct scrollTop by hand — this finds the element that
// actually scrolls so we can measure and adjust it. Matched by overflow style
// alone (not current scrollability): during the loading placeholder the content
// isn't tall enough to overflow yet, but we still need the scroller to attach
// listeners and land the anchor once data arrives. Walking *up* from the schedule
// root never passes through the horizontal date strip, so this can't mismatch it.
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement ?? null;
  while (n) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return n;
    n = n.parentElement;
  }
  return null;
}

interface TimedItem {
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
}

interface DayPlan {
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

interface DayCtx {
  visibleEvents: ExternalEvent[];
  blocks: Task[];
  hidden: Set<string>;
  workStart: number;
  workEnd: number;
  now: Date;
}

// The one place a calendar date becomes a plan — used by both the month grid
// (for its free/busy density) and the schedule agenda (for the full read).
function buildDayPlan(date: Date, ctx: DayCtx): DayPlan {
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

function readMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "month" || v === "schedule") return v;
  } catch {
    /* ignore */
  }
  return "month";
}

export default function MobileCalendar({ now, onTapEvent }: { now: Date; onTapEvent?: (tap: CalendarTap) => void }) {
  const { settings } = useSettings();

  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  // The month the grid is showing, and the day the schedule is anchored to.
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(now));
  const [selected, setSelected] = useState(() => startOfDay(now));
  // How many days of history are loaded behind the anchor in the schedule. Reset
  // to PAST_WINDOW on each entry so you always land with two weeks of scroll-up
  // room; "Earlier" grows it.
  const [pastDays, setPastDays] = useState(PAST_WINDOW);

  // The fetch window follows the active lens: the full month grid (up to 6
  // weeks) in month mode, or — in the schedule — the loaded history behind the
  // selected day through the 14-day forward horizon.
  const range = useMemo(() => {
    if (mode === "month") {
      const gridStart = startOfWeek(startOfMonth(monthCursor), WEEK_OPTS);
      const gridEnd = addDays(endOfWeek(endOfMonth(monthCursor), WEEK_OPTS), 1);
      return { start: gridStart.toISOString(), end: gridEnd.toISOString() };
    }
    const anchor = startOfDay(selected);
    const start = addDays(anchor, -pastDays);
    return { start: start.toISOString(), end: new Date(anchor.getTime() + HORIZON_DAYS * DAY_MS).toISOString() };
  }, [mode, monthCursor, selected, pastDays]);

  const { data: events = [], isLoading: evLoading } = useExternalEvents(range.start, range.end);
  const { data: blocks = [], isLoading: blkLoading } = useScheduledTasks(range.start, range.end);

  const showWeather = settings?.show_weather ?? false;
  const { data: weatherData } = useWeather(showWeather);
  const weatherIndex = useMemo(() => indexWeather(weatherData?.days), [weatherData]);

  const hidden = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const hiddenEventKeys = useMemo(() => new Set((settings?.hidden_events ?? []).map((h) => h.key)), [settings]);
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;

  const dayCtx = useMemo<DayCtx>(() => {
    const visibleEvents = events.filter((e) => !hidden.has(e.calendar_id) && !isEventHidden(e, hiddenEventKeys));
    return { visibleEvents, blocks, hidden, workStart, workEnd, now };
  }, [events, blocks, hidden, hiddenEventKeys, workStart, workEnd, now]);

  const loading = evLoading || blkLoading;

  const pickDay = (date: Date) => {
    const d = startOfDay(date);
    setSelected(d);
    setMonthCursor(startOfMonth(d));
    setPastDays(PAST_WINDOW);
    setMode("schedule");
  };

  // Month is home; the schedule is the drill-in. Tapping a day (or swiping up)
  // pushes into the schedule; the schedule's back header pops back to the month.
  const openSchedule = () => {
    setPastDays(PAST_WINDOW);
    setMode("schedule");
  };
  const backToMonth = () => setMode("month");

  return (
    <div className="pb-24">
      {mode === "month" ? (
        <MonthView
          monthCursor={monthCursor}
          ctx={dayCtx}
          now={now}
          selected={selected}
          weatherIndex={showWeather ? weatherIndex : null}
          onPrev={() => setMonthCursor((c) => startOfMonth(addMonths(c, -1)))}
          onNext={() => setMonthCursor((c) => startOfMonth(addMonths(c, 1)))}
          onToday={() => {
            setMonthCursor(startOfMonth(now));
            setSelected(startOfDay(now));
          }}
          onPick={pickDay}
          onOpenSchedule={openSchedule}
        />
      ) : (
        <ScheduleView
          anchor={selected}
          ctx={dayCtx}
          weatherIndex={showWeather ? weatherIndex : null}
          loading={loading}
          pastDays={pastDays}
          onLoadEarlier={() => setPastDays((p) => p + PAST_STEP)}
          onTapEvent={onTapEvent}
          onBack={backToMonth}
        />
      )}
    </div>
  );
}

// ── Month grid ───────────────────────────────────────────────────────────
// The whole month at a glance: each day carries free/busy density dots so you
// can scan for open days, then tap in for the full schedule. Swipe or arrow
// between months.
function MonthView({
  monthCursor,
  ctx,
  now,
  selected,
  weatherIndex,
  onPrev,
  onNext,
  onToday,
  onPick,
  onOpenSchedule,
}: {
  monthCursor: Date;
  ctx: DayCtx;
  now: Date;
  selected: Date;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPick: (d: Date) => void;
  onOpenSchedule: () => void;
}) {
  const gridStart = useMemo(() => startOfWeek(startOfMonth(monthCursor), WEEK_OPTS), [monthCursor]);
  const cells = useMemo(() => {
    const gridEnd = endOfWeek(endOfMonth(monthCursor), WEEK_OPTS);
    const out: DayPlan[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      out.push(buildDayPlan(d, ctx));
    }
    return out;
  }, [gridStart, monthCursor, ctx]);

  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(gridStart, i).toLocaleDateString([], { weekday: "short" }).slice(0, 2)),
    [gridStart],
  );

  const isCurrentMonth = isSameMonth(monthCursor, now);

  // Lightweight swipe (no HTML5 DnD — Tauri swallows it): horizontal changes
  // months, an upward swipe drops into the schedule (the "expand" gesture).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = (t?.clientX ?? touch.current.x) - touch.current.x;
    const dy = (t?.clientY ?? touch.current.y) - touch.current.y;
    touch.current = null;
    if (Math.abs(dy) > Math.abs(dx)) {
      if (dy <= -SWIPE_PX) onOpenSchedule(); // swipe up → expand into the schedule
    } else if (dx <= -SWIPE_PX) onNext();
    else if (dx >= SWIPE_PX) onPrev();
  };

  return (
    <div>
      {/* Month header — serif month label, ≥44px nav controls. */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1">
        <h2 className="text-lead masthead flex-1 text-ink">{format(monthCursor, "MMMM yyyy")}</h2>
        {!isCurrentMonth && (
          <button
            onClick={onToday}
            className="tap fast mr-1 rounded-full border border-line px-3 py-1 text-label font-medium text-muted active:bg-surface-2"
          >
            Today
          </button>
        )}
        <button
          onClick={onPrev}
          aria-label="Previous month"
          className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-head text-muted active:bg-surface-2"
        >
          ‹
        </button>
        <button
          onClick={onNext}
          aria-label="Next month"
          className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-head text-muted active:bg-surface-2"
        >
          ›
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 px-2">
        {weekdays.map((w, i) => (
          <div key={i} className="py-1.5 text-center text-micro font-medium uppercase text-muted">
            {w}
          </div>
        ))}
      </div>

      {/* The grid — the paper itself, single-plane and transparent. touch-pan-y
          keeps horizontal swipes for month nav (not the browser's back gesture). */}
      <div className="grid touch-pan-y grid-cols-7 px-2" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {cells.map((d) => (
          <MonthCell
            key={dayKey(d.date)}
            day={d}
            inMonth={isSameMonth(d.date, monthCursor)}
            isSelected={isSameDay(d.date, selected)}
            wx={weatherIndex?.get(d.date.toLocaleDateString("en-CA"))}
            onPick={onPick}
          />
        ))}
      </div>

      {/* The availability of the selected day — a one-line answer under the grid
          so the month view still says "are you free?". Only while the selected
          day is in view, so the readout can't disagree with the month on screen. */}
      {isSameMonth(selected, monthCursor) && (
        <SelectedSummary day={buildDayPlan(selected, ctx)} onOpen={() => onPick(selected)} />
      )}
    </div>
  );
}

function MonthCell({
  day,
  inMonth,
  isSelected,
  wx,
  onPick,
}: {
  day: DayPlan;
  inMonth: boolean;
  isSelected: boolean;
  wx: { wmo: number } | undefined;
  onPick: (d: Date) => void;
}) {
  const { date, isToday, timed, allDay } = day;
  const blkCount = timed.filter((t) => t.kind === "block").length;
  const evCount = timed.filter((t) => t.kind === "event").length + allDay.length;
  // Up to 3 density dots — tasks (accent) first, then events (neutral).
  const dots = [
    ...Array(blkCount).fill("block"),
    ...Array(evCount).fill("event"),
  ].slice(0, 3) as ("block" | "event")[];

  return (
    <button
      onClick={() => onPick(date)}
      className={`tap fast relative flex aspect-square flex-col items-center justify-start gap-1 rounded-xl py-1.5 ${
        isSelected ? "glass-lift" : "active:bg-surface-2"
      }`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-body leading-none ${
          isToday ? "bg-accent font-semibold text-white" : isSelected ? "font-semibold text-ink" : ""
        } ${!inMonth ? "text-muted/50" : isToday ? "" : "text-ink"}`}
      >
        {date.getDate()}
      </span>
      {wx ? (
        <WeatherIcon wmo={wx.wmo} size={12} />
      ) : (
        <span className="flex h-1.5 items-center gap-0.5">
          {dots.map((k, i) => (
            <span
              key={i}
              className="h-1 w-1 rounded-full"
              style={{ background: k === "block" ? "var(--accent)" : "var(--line-strong)" }}
            />
          ))}
        </span>
      )}
    </button>
  );
}

// A single line under the grid: the tapped day and whether it's open, plus a
// nudge into its full schedule.
function SelectedSummary({ day, onOpen }: { day: DayPlan; onOpen: () => void }) {
  const { date, timed, allDay, openMins, isPast } = day;
  const busy = timed.length + allDay.length;
  const status = isPast
    ? "done for today"
    : openMins > 0
      ? `${fmtMins(openMins)} open`
      : busy > 0
        ? "fully booked"
        : "wide open";
  return (
    <button
      onClick={onOpen}
      className="tap fast mt-3 flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left active:bg-surface-2"
    >
      <span className="text-body font-medium text-ink">
        {date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
      </span>
      <span className="mono text-label" style={{ color: openMins > 0 && !isPast ? "var(--accent)" : "var(--muted)" }}>
        {status}
      </span>
      <span className="ml-auto text-muted">→</span>
    </button>
  );
}

// ── Schedule (agenda) ──────────────────────────────────────────────────────
// A bidirectional availability list. You land on the anchor day (today by
// default) sitting just under the sticky bars, with PAST_WINDOW days of history
// already loaded *above* it — so scrolling up walks you back through what
// happened, and scrolling down runs the 14-day forward horizon. "Earlier" at the
// top reveals more history on demand.
function ScheduleView({
  anchor,
  ctx,
  weatherIndex,
  loading,
  pastDays,
  onLoadEarlier,
  onTapEvent,
  onBack,
}: {
  anchor: Date;
  ctx: DayCtx;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  loading: boolean;
  pastDays: number;
  onLoadEarlier: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onBack: () => void;
}) {
  const days = useMemo<DayPlan[]>(() => {
    const start = addDays(startOfDay(anchor), -pastDays);
    const total = pastDays + HORIZON_DAYS;
    return Array.from({ length: total }, (_, i) => buildDayPlan(addDays(start, i), ctx));
  }, [anchor, pastDays, ctx]);

  const anchorKey = dayKey(startOfDay(anchor));

  const rootRef = useRef<HTMLDivElement>(null);
  const stripWrapRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  const stripRefs = useRef<Record<string, HTMLElement | null>>({});

  const jumpTo = (key: string) => {
    dayRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Scroll anchoring (WebKit has no `overflow-anchor`) ──────────────────
  // A "hold": keep a chosen day at a fixed offset from the scroller top across
  // layout changes — the initial land and an "earlier" prepend — so the page
  // never jumps under the reader's thumb.
  //
  // The subtle part is *when to stop holding*. The day the anchor sits above can
  // fill in late (a heavy day arriving after `loading` already flipped false),
  // and that reflow happens *above* the anchor — which, with no native scroll
  // anchoring on WebKit, shoves the anchor down out of view. So we don't release
  // on a single `loading` flip; we re-assert on every height change and only let
  // go once the layout has been quiet for a beat, or the moment the user scrolls.
  const hold = useRef<{ key: string; offset: number } | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const releaseHold = () => {
    hold.current = null;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
  };

  // A fresh entry (new anchor) lands on the anchor day, tucked under the sticky
  // bars. Set during render so the assert effect sees it on the very first commit.
  const prevAnchor = useRef<string | null>(null);
  if (prevAnchor.current !== anchorKey) {
    prevAnchor.current = anchorKey;
    hold.current = { key: anchorKey, offset: STICKY_OFFSET };
  }

  useLayoutEffect(() => {
    const h = hold.current;
    if (!h) return;
    const scroller = scrollParent(rootRef.current);
    const el = dayRefs.current[h.key];
    // Not laid out yet (still loading, showing the placeholder) — keep the hold
    // alive without arming release, so it survives the wait for first data.
    if (!scroller || !el) return;
    const cur = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const delta = cur - h.offset;
    if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    // Debounced release: every height change (data trickling in) pushes the
    // release out, so we let go only after ~1s of layout quiet.
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      hold.current = null;
    }, 1000);
  }, [days, loading, anchorKey]);

  // The user taking over ends the hold immediately — a real scroll gesture must
  // never be fought. (Programmatic scrollTop writes fire only `scroll`, which we
  // don't listen for, so the hold can't cancel itself.)
  useEffect(() => {
    const scroller = scrollParent(rootRef.current);
    if (!scroller) return;
    const events = ["wheel", "touchstart", "pointerdown", "keydown"];
    for (const e of events) scroller.addEventListener(e, releaseHold, { passive: true });
    return () => {
      for (const e of events) scroller.removeEventListener(e, releaseHold);
    };
  }, []);

  // Center the anchor chip in the horizontally-scrolling date strip on entry,
  // without disturbing the vertical hold.
  useEffect(() => {
    const wrap = stripWrapRef.current;
    const el = stripRefs.current[anchorKey];
    if (!wrap || !el) return;
    const wr = wrap.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    wrap.scrollLeft += er.left - wr.left - (wr.width - er.width) / 2;
  }, [anchorKey]);

  // Reveal more history, holding the current top day in place so the new days
  // arrive above the fold rather than yanking the list.
  const loadEarlier = () => {
    const scroller = scrollParent(rootRef.current);
    const firstKey = dayKey(days[0].date);
    const el = scroller ? dayRefs.current[firstKey] : null;
    if (scroller && el) {
      hold.current = {
        key: firstKey,
        offset: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      };
    }
    onLoadEarlier();
  };

  return (
    <div ref={rootRef}>
      {/* Back header — pops to the month grid and names where you'll land. */}
      <div className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <button
          onClick={onBack}
          className="tap fast flex items-center gap-0.5 px-3 py-2.5 text-body font-medium text-accent active:opacity-70"
        >
          <span className="text-head leading-none">‹</span>
          {format(anchor, "MMMM yyyy")}
        </button>
      </div>

      {/* Date strip — tap a day to jump to it. Past days read muted. */}
      <div className="sticky top-[45px] z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div ref={stripWrapRef} className="mobile-scroll flex gap-1.5 overflow-x-auto px-3 py-2.5">
          {days.map((d) => {
            const key = dayKey(d.date);
            const busyDay = d.timed.length > 0 || d.allDay.length > 0;
            const dateStr = d.date.toLocaleDateString("en-CA");
            const wx = weatherIndex?.get(dateStr);
            return (
              <button
                key={key}
                ref={(el) => {
                  stripRefs.current[key] = el;
                }}
                onClick={() => jumpTo(key)}
                className={`tap fast flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border py-1.5 ${
                  d.isToday ? "border-accent bg-accent-soft" : d.isBygone ? "border-line opacity-60" : "border-line"
                }`}
              >
                <span className={`text-micro font-medium uppercase ${d.isToday ? "text-accent" : "text-muted"}`}>
                  {d.date.toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
                </span>
                <span
                  className={`text-body font-semibold leading-none ${
                    d.isToday ? "text-accent" : d.isBygone ? "text-muted" : "text-ink"
                  }`}
                >
                  {d.date.getDate()}
                </span>
                {wx ? (
                  <WeatherIcon wmo={wx.wmo} size={12} />
                ) : (
                  <span
                    className="h-1 w-1 rounded-full"
                    style={{ background: busyDay ? "var(--line-strong)" : "transparent" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {loading && days.every((d) => d.timed.length === 0 && d.allDay.length === 0) ? (
        <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>
      ) : (
        // overflow-anchor: none so the one scroll-anchoring authority is our
        // manual pin. Chromium would otherwise also shift scrollTop on prepend
        // (double-correcting); WebKit — the real iOS/Tauri target — has no native
        // anchoring at all. Opting out makes both engines behave identically.
        <div className="divide-y divide-line" style={{ overflowAnchor: "none" }}>
          {/* Reach further back — the top of history. */}
          <button
            onClick={loadEarlier}
            className="tap fast flex w-full items-center justify-center gap-1.5 py-3.5 text-label font-medium text-muted active:bg-surface-2"
          >
            <span className="text-body leading-none">↑</span>
            Earlier days
          </button>
          {days.map((d) => (
            <DayCard
              key={dayKey(d.date)}
              day={d}
              innerRef={(el) => {
                dayRefs.current[dayKey(d.date)] = el;
              }}
              onTapEvent={onTapEvent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One day: header with a free/busy read, the day's events, and — the point of
// this whole view — its open windows spelled out so you can answer on the spot.
function DayCard({
  day,
  innerRef,
  onTapEvent,
}: {
  day: DayPlan;
  innerRef: (el: HTMLElement | null) => void;
  onTapEvent?: (tap: CalendarTap) => void;
}) {
  const { date, isToday, label, allDay, timed, gaps, openMins, isPast, isBygone } = day;
  const fullyOpen = timed.length === 0 && allDay.length === 0;
  const busyCount = timed.length + allDay.length;

  // A past date is a record of what happened, not an availability question —
  // its readout counts commitments and it never advertises open windows.
  const readout = isBygone
    ? busyCount > 0
      ? `${busyCount} scheduled`
      : ""
    : isPast
      ? "done for today"
      : openMins > 0
        ? `${fmtMins(openMins)} open`
        : "fully booked";
  const readoutAccent = !isBygone && !isPast && openMins > 0;

  return (
    <section ref={innerRef} className="scroll-mt-[112px] px-4 py-3.5">
      {/* Day header */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-head font-semibold ${isToday ? "text-accent" : isBygone ? "text-muted" : "text-ink"}`}>
            {label}
          </span>
          <span className="mono text-label text-muted">{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
        </div>
        {readout && (
          <span className="mono text-label" style={{ color: readoutAccent ? "var(--accent)" : "var(--muted)" }}>
            {readout}
          </span>
        )}
      </div>

      {/* All-day banners */}
      {allDay.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <button
              key={e.id}
              onClick={() =>
                onTapEvent?.({
                  kind: "event",
                  id: e.id,
                  title: e.title || "Busy",
                  start: new Date(e.start_at),
                  end: new Date(e.end_at),
                  allDay: true,
                  location: e.location,
                  self_rsvp: e.self_rsvp ?? null,
                })
              }
              className="tap fast mono rounded-md border border-line bg-surface-2 px-2 py-0.5 text-label text-muted active:bg-surface"
            >
              {e.title || "Busy"}
            </button>
          ))}
        </div>
      )}

      {/* Timed commitments */}
      {timed.length > 0 && (
        <div className="space-y-1.5">
          {timed.map((b, i) => {
            const tap: CalendarTap =
              b.kind === "event"
                ? { kind: "event", id: b.eventId!, title: b.title || "Untitled", start: b.start, end: b.end, location: b.location ?? null, self_rsvp: b.self_rsvp }
                : { kind: "block", taskId: b.taskId!, title: b.title || "Untitled", start: b.start, end: b.end, done: !!b.done };
            return (
              <button
                key={i}
                onClick={() => onTapEvent?.(tap)}
                className="tap fast -mx-1 flex w-full items-baseline gap-2.5 rounded-lg px-1 text-left active:bg-surface-2"
              >
                <span
                  className="mono w-[68px] shrink-0 text-right text-meta"
                  style={{ color: b.kind === "block" ? "var(--accent)" : "var(--muted)" }}
                >
                  {at(b.start)}
                </span>
                <span
                  className="mt-[5px] h-1.5 w-1.5 shrink-0 self-start rounded-full"
                  style={{ background: b.kind === "block" ? "var(--accent)" : "var(--line-strong)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-body ${b.done ? "text-muted line-through" : "text-ink"}`}>{b.title || "Untitled"}</div>
                  <div className="mono text-meta text-muted">
                    {at(b.start)}–{at(b.end)}
                    {b.location ? ` · ${b.location}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Open windows — the availability answer. A bygone day is history, so we
          don't offer to fill windows that have already elapsed. */}
      {!isPast && !isBygone && gaps.length > 0 && (
        <div className={timed.length > 0 || allDay.length > 0 ? "mt-3" : ""}>
          {!fullyOpen && <div className="section-label mb-1.5 !p-0">Free</div>}
          <div className="flex flex-wrap gap-1.5">
            {gaps.map((g, i) => (
              <span
                key={i}
                className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-label font-medium text-accent"
              >
                {at(g.start)}–{at(g.end)} · {fmtMins(g.mins)}
              </span>
            ))}
          </div>
        </div>
      )}

      {fullyOpen && !isPast && (isBygone || gaps.length === 0) && (
        <div className="text-body text-muted">{isBygone ? "Nothing scheduled." : "No commitments — wide open."}</div>
      )}
    </section>
  );
}
