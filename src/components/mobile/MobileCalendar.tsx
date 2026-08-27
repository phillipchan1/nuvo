import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
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
import { useSettings, firstDayOfWeek } from "../../hooks/useSettings";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks, usePlannedAnytimeTasks } from "../../hooks/useTasks";
import { useSlots, useSlotTasks } from "../../hooks/useSlots";
import { useVertical } from "../../hooks/useVertical";
import { blockDesignation, deriveSlotTitle } from "../../lib/slots";
import { fmtMins, isEventHidden } from "../../lib/now";
import type { Task } from "../../lib/types";
import { parseDateISO } from "../../lib/dates";
import { clearCalendarReveal, onCalendarReveal, pendingCalendarReveal } from "../../lib/calendarReveal";
import type { CalendarTap } from "./MobileEventSheet";
import { useWeather, indexWeather } from "../../hooks/useWeather";
import WeatherIcon from "../WeatherIcon";
import TimeZoneChip from "../TimeZoneChip";
import {
  DAY_MS,
  at,
  buildDayPlan,
  dayKey,
  dayReadout,
  scrollParent,
  type DayCtx,
  type DayPlan,
} from "./dayPlan";
import MobileDayView, { CalLensPill, type CalLens } from "./MobileDayView";
import MobileWeekView from "./MobileWeekView";
import MobileYearView, { mobileYearRange } from "./MobileYearView";
import MobileWeekCrown from "./MobileWeekCrown";
import TimePager from "./TimePager";
import type { RenderCrownTask } from "../../hooks/useWeekCrown";

// The mobile Calendar — three lenses on the same live day-shape math:
//   • Month — the whole month at a glance (free/busy density per day), swipe or
//     arrow between months, tap any day to drop into its schedule. The selected
//     day's plan sits under the grid (D-119) — not the week's crown.
//   • Schedule (List) — a 14-day agenda from the selected day, where each day
//     shows its commitments AND its open windows, computed by the same readDay()
//     Now uses.
//   • Day — one day as a proportional time grid (MobileDayView): the same
//     commitments and open windows, drawn to scale so duration reads instantly.
//   • Year — the whole year shaded by load (MobileYearView), reached by tapping
//     the year beside the month name; a month taps back down into the grid.
// All read from one buildDayPlan() (dayPlan.ts), so "what counts as busy" lives
// in one place. Time travel (left = later, right = earlier) is one TimePager
// on every paged lens — finger-follow + in/out, never a show-and-hide.

const HORIZON_DAYS = 14;
// The schedule opens on the anchor day (today) as the FIRST rendered day, so the
// scroll starts at the top on it — correct by construction, nothing to measure or
// race. History is revealed *upward* on demand: the "Earlier days" control at the
// top prepends PAST_STEP days at a time, holding the prior top day in place.
const PAST_STEP = 14; // days of history the "earlier" control reveals per tap
// Where the newly-revealed most-recent past day is parked after an "earlier" tap:
// just under the two sticky bars (back header + date strip). Matches DayCard's
// scroll-mt so tap-to-jump and this reveal agree.
const REVEAL_OFFSET = 112;
const MODE_KEY = "nuvo-mobile-cal-mode";
// How far the Day lens fetches around the selected day's week. Anchoring the
// window to the week (not the day) keeps the query key stable while you swipe
// within a week, so day-to-day traversal is instant from cache.
const DAY_FETCH_BEHIND = 7;
const DAY_FETCH_AHEAD = 21;

type Mode = "month" | "schedule" | "day" | "week" | "year";

function readMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "month" || v === "schedule" || v === "day" || v === "week" || v === "year") return v;
  } catch {
    /* ignore */
  }
  return "month";
}

export default function MobileCalendar({
  now,
  onTapEvent,
  onTapTask,
  onOpenUpkeep,
  onNewEvent,
  onOpenProject,
  renderCrownTask,
  onPlanWeek,
  initialMode,
}: {
  now: Date;
  onTapEvent?: (tap: CalendarTap) => void;
  /** Untimed (anytime) task chips — open the task sheet, not the event sheet. */
  onTapTask?: (taskId: string) => void;
  onOpenUpkeep?: () => void;
  /** Opens the new-event sheet, seeded on the day the user was looking at. */
  onNewEvent?: (date: Date) => void;
  /** The week crown's doors — omit them and the crown stays off (harnesses,
   *  and any embed that has nowhere to route a record). */
  onOpenProject?: (id: string) => void;
  /** how the week crown renders a project's work — see `RenderCrownTask`. */
  renderCrownTask?: RenderCrownTask;
  onPlanWeek?: () => void;
  /** Harnesses pin a lens without writing `nuvo-mobile-cal-mode`. */
  initialMode?: Mode;
}) {
  const { settings } = useSettings();

  // Which day the grid opens a week on — the user's "Week starts on" setting
  // (Settings → Calendar), the same one the desktop CalendarPane reads. This is
  // a *display* preference only: the planning week stays Monday-based in the
  // kernel, so a Sunday-start grid never moves what week a task belongs to.
  const firstDay = firstDayOfWeek(settings);
  const weekOpts = useMemo(() => ({ weekStartsOn: firstDay }), [firstDay]);

  const persistMode = initialMode == null;
  const [mode, setModeState] = useState<Mode>(() => initialMode ?? readMode());
  const setMode = (m: Mode) => {
    setModeState(m);
    if (!persistMode) return;
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  // The month the grid is showing, and the day the schedule is anchored to.
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(now));
  const [yearCursor, setYearCursor] = useState(() => now.getFullYear());
  const [selected, setSelected] = useState(() => startOfDay(now));

  // "Take me to that day" — landing here from a calendar search hit. The bus
  // rather than a prop, for the reason in lib/calendarReveal.ts; and the pending
  // drain matters more here than on the desktop, because search *switches tabs*
  // and this component mounts a frame after the publish.
  useEffect(() => {
    const go = (dateISO: string) => {
      const d = startOfDay(parseDateISO(dateISO));
      setSelected(d);
      setMonthCursor(startOfMonth(d));
      // Day is the only mode that shows a specific moment; a month grid that
      // merely scrolled would leave the user hunting for what they searched for.
      setMode("day");
    };
    const pending = pendingCalendarReveal();
    if (pending) {
      go(pending.dateISO);
      clearCalendarReveal();
    }
    return onCalendarReveal((r) => {
      go(r.dateISO);
      clearCalendarReveal();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // How many days of history are loaded above the anchor in the schedule. Starts
  // at 0 so the schedule always opens ON the anchor day (top of the list); the
  // "Earlier" control grows it. Reset to 0 on each entry.
  const [pastDays, setPastDays] = useState(0);
  // The last drill-in lens (List, Day or Week) — where a month tap lands you,
  // seeded from the persisted mode so the preference survives a reload. Year is
  // a drill-*out*, so it can never be the answer here: landing a day tap on it
  // would zoom away from the very day you tapped.
  const drill = useRef<Exclude<Mode, "month" | "year">>(
    mode === "month" || mode === "year" ? "schedule" : mode,
  );

  // The fetch window follows the active lens: the full month grid (up to 6
  // weeks) in month mode; in the schedule, the loaded history behind the
  // selected day through the 14-day forward horizon; in the Day lens, a window
  // anchored to the selected day's week so swiping within a week stays on one
  // cached query.
  const range = useMemo(() => {
    if (mode === "year") return mobileYearRange(yearCursor);
    if (mode === "month") {
      // A month either side of the cursor, so a swipe peek at the next/last
      // month already has its dots — an empty peek that fills in after commit
      // is the old show-and-hide wearing a slide.
      const gridStart = startOfWeek(startOfMonth(addMonths(monthCursor, -1)), weekOpts);
      const gridEnd = addDays(endOfWeek(endOfMonth(addMonths(monthCursor, 1)), weekOpts), 1);
      return { start: gridStart.toISOString(), end: gridEnd.toISOString() };
    }
    // Day and Week share one window, anchored to the selected day's WEEK, so
    // swiping a day (or paging a week) inside it stays on one cached query and
    // the Day ↔ Week toggle never refetches.
    if (mode === "day" || mode === "week") {
      const wk = startOfWeek(startOfDay(selected), weekOpts);
      return {
        start: addDays(wk, -DAY_FETCH_BEHIND).toISOString(),
        end: addDays(wk, DAY_FETCH_AHEAD + 1).toISOString(),
      };
    }
    const anchor = startOfDay(selected);
    const start = addDays(anchor, -pastDays);
    return { start: start.toISOString(), end: new Date(anchor.getTime() + HORIZON_DAYS * DAY_MS).toISOString() };
  }, [mode, monthCursor, selected, pastDays, weekOpts, yearCursor]);

  const { data: events = [], isLoading: evLoading } = useExternalEvents(range.start, range.end);
  const { data: blocks = [], isLoading: blkLoading } = useScheduledTasks(range.start, range.end);
  // Standing slots — a slot is its own timed container; a task placed inside
  // one rides the slot's time instead of carrying its own start_time (see
  // assignToSlot, useTasks.ts), so it has to be fetched alongside the plain
  // scheduled blocks or it's invisible here. Same queries desktop's
  // Planner.tsx uses for CalendarPane — including anytime (planned, no clock),
  // which used to exist only on the desktop all-day row, so a ＋ capture from
  // this tab vanished the moment the sheet closed.
  const { data: slots = [], isLoading: slotLoading } = useSlots(range.start, range.end);
  const { data: anytime = [] } = usePlannedAnytimeTasks(range.start, range.end);
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);
  const { data: slotChildTasks = [] } = useSlotTasks(slotIds);
  const { data: vertical } = useVertical();

  const showWeather = settings?.show_weather ?? false;
  const { data: weatherData } = useWeather(showWeather);
  const weatherIndex = useMemo(() => indexWeather(weatherData?.days), [weatherData]);

  const hidden = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const hiddenEventKeys = useMemo(() => new Set((settings?.hidden_events ?? []).map((h) => h.key)), [settings]);
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;

  const slotChildren = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of slotChildTasks) {
      if (!t.slot_id) continue;
      (m[t.slot_id] ??= []).push(t);
    }
    return m;
  }, [slotChildTasks]);

  // Same derivation desktop's Planner.tsx feeds CalendarPane — a slot with no
  // typed title takes its name from its project, its children's shared
  // domain, or a plain time-of-day label, so the two shells never disagree
  // about what to call the same block.
  const slotTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) m.set(s.id, deriveSlotTitle(s, slotChildren[s.id] ?? [], vertical));
    return m;
  }, [slots, slotChildren, vertical]);

  const dayCtx = useMemo<DayCtx>(() => {
    const visibleEvents = events.filter((e) => !hidden.has(e.calendar_id) && !isEventHidden(e, hiddenEventKeys));
    return { visibleEvents, blocks, anytime, slots, slotChildren, slotTitles, hidden, workStart, workEnd, now };
  }, [events, blocks, anytime, slots, slotChildren, slotTitles, hidden, hiddenEventKeys, workStart, workEnd, now]);

  const loading = evLoading || blkLoading || slotLoading;

  const pickDay = (date: Date) => {
    const d = startOfDay(date);
    setSelected(d);
    setMonthCursor(startOfMonth(d));
    setPastDays(0);
    setMode(drill.current);
  };

  // Month is home; List and Day are the two drill-in lenses (a tap or an upward
  // swipe opens whichever you used last). Their back headers pop to the month —
  // synced to wherever the Day lens wandered.
  const openSchedule = () => {
    setPastDays(0);
    setMode(drill.current);
  };
  const backToMonth = () => {
    setMonthCursor(startOfMonth(selected));
    setMode("month");
  };

  // Switch drill-in lenses, optionally landing on a specific day — the List →
  // Day toggle hands over the day you were scrolled to, so you keep your place.
  const setLens = (lens: CalLens, day?: Date) => {
    drill.current = lens;
    if (day) {
      const d = startOfDay(day);
      setSelected(d);
      setMonthCursor(startOfMonth(d));
    }
    setPastDays(0);
    setMode(lens);
  };

  // Zoom out to the Year, on the year the user is looking at.
  const openYear = () => {
    setYearCursor(monthCursor.getFullYear());
    setMode("year");
  };

  return (
    <div className="fab-clear">
      {/* The week's crown — the Schedule rail's crown, on the phone.
          It rides the week-scoped lenses (List · Day · Week): "what is this
          week carrying" is the context you read a Tuesday against (D-110).
          Month and Year answer a different question — where is this span
          heavy, and what's on the day you tapped — so the crown stays off
          them (D-119). A crown you can only reach by backing out to the month
          was the original failure; taking it *off* the month is not that. */}
      {onOpenProject && renderCrownTask && onPlanWeek && (mode === "schedule" || mode === "day" || mode === "week") && (
        <MobileWeekCrown
          now={now}
          onOpenProject={onOpenProject}
          renderTask={renderCrownTask}
          onOpenDay={(d) => setLens("day", d)}
          onPlanWeek={onPlanWeek}
        />
      )}
      {mode === "year" ? (
        <MobileYearView
          year={yearCursor}
          ctx={dayCtx}
          now={now}
          weekStartsOn={firstDay}
          loading={loading}
          onPrev={() => setYearCursor((y) => y - 1)}
          onNext={() => setYearCursor((y) => y + 1)}
          onToday={() => setYearCursor(now.getFullYear())}
          onBack={() => setMode("month")}
          onPickMonth={(m) => {
            setMonthCursor(startOfMonth(m));
            setMode("month");
          }}
        />
      ) : mode === "month" ? (
        <MonthView
          monthCursor={monthCursor}
          ctx={dayCtx}
          now={now}
          selected={selected}
          weekStartsOn={firstDay}
          weatherIndex={showWeather ? weatherIndex : null}
          onPrev={() => setMonthCursor((c) => startOfMonth(addMonths(c, -1)))}
          onNext={() => setMonthCursor((c) => startOfMonth(addMonths(c, 1)))}
          onToday={() => {
            setMonthCursor(startOfMonth(now));
            setSelected(startOfDay(now));
          }}
          onPick={pickDay}
          onOpenSchedule={openSchedule}
          onOpenYear={openYear}
          onOpenUpkeep={onOpenUpkeep}
          onNewEvent={onNewEvent ? () => onNewEvent(selected) : undefined}
          onTapEvent={onTapEvent}
          onTapTask={onTapTask}
        />
      ) : mode === "week" ? (
        <MobileWeekView
          selected={selected}
          weekStartsOn={firstDay}
          ctx={dayCtx}
          loading={loading}
          onSelect={(d) => setSelected(startOfDay(d))}
          onLens={(l, day) => setLens(l, day)}
          onBack={backToMonth}
          onTapEvent={onTapEvent}
          onNewEvent={onNewEvent ? () => onNewEvent(selected) : undefined}
        />
      ) : mode === "day" ? (
        <MobileDayView
          selected={selected}
          weekStartsOn={firstDay}
          ctx={dayCtx}
          weatherIndex={showWeather ? weatherIndex : null}
          loading={loading}
          onSelect={(d) => setSelected(startOfDay(d))}
          onLens={(l) => setLens(l)}
          onBack={backToMonth}
          onTapEvent={onTapEvent}
          onTapTask={onTapTask}
          onNewEvent={onNewEvent ? () => onNewEvent(selected) : undefined}
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
          onTapTask={onTapTask}
          onBack={backToMonth}
          onDayLens={(d) => setLens("day", d)}
          onNewEvent={onNewEvent ? () => onNewEvent(selected) : undefined}
          onJumpTo={(d) => {
            const day = startOfDay(d);
            setSelected(day);
            setMonthCursor(startOfMonth(day));
            setPastDays(0);
          }}
        />
      )}
    </div>
  );
}

// ── Jump to any date — the OS picker behind a 44px glyph ─────────────────────
function DateJump({ anchor, onJumpTo }: { anchor: Date; onJumpTo: (d: Date) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          // `showPicker` where it exists (iOS 16+, every desktop engine we run
          // on); focus is the honest fallback rather than a dead glyph.
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        aria-label="Jump to date"
        className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-surface-2"
      >
        <Icon name="calendar" size={16} />
      </button>
      <input
        ref={ref}
        type="date"
        value={anchor.toLocaleDateString("en-CA")}
        onChange={(e) => {
          const [y, m, d] = e.target.value.split("-").map(Number);
          if (y && m && d) onJumpTo(new Date(y, m - 1, d));
        }}
        aria-label="Jump to date"
        className="sr-only"
        tabIndex={-1}
      />
    </>
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
  weekStartsOn,
  weatherIndex,
  onPrev,
  onNext,
  onToday,
  onPick,
  onOpenSchedule,
  onOpenYear,
  onOpenUpkeep,
  onNewEvent,
  onTapEvent,
  onTapTask,
}: {
  monthCursor: Date;
  ctx: DayCtx;
  now: Date;
  selected: Date;
  weekStartsOn: 0 | 1;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPick: (d: Date) => void;
  onOpenSchedule: () => void;
  /** Stand back to the Year — the month title is the door. */
  onOpenYear: () => void;
  onOpenUpkeep?: () => void;
  onNewEvent?: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
}) {
  const isCurrentMonth = isSameMonth(monthCursor, now);
  const sheet = (month: Date) => (
    <MonthSheet
      monthCursor={month}
      ctx={ctx}
      selected={selected}
      weekStartsOn={weekStartsOn}
      weatherIndex={weatherIndex}
      onPick={onPick}
      onTapEvent={onTapEvent}
      onTapTask={onTapTask}
    />
  );

  return (
    <div>
      {/* Month header — serif month label, ≥44px nav controls. The title is the
          zoom-out door (iOS Calendar's grammar): tapping it stands back to the
          Year. A chevron marks it, because an invisible affordance is worse
          than a hover-only one — and on a phone there is no hover to fall back
          on. Costs no extra row: the header is already this tall. */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1">
        <button
          onClick={onOpenYear}
          aria-label={`Stand back to ${format(monthCursor, "yyyy")}`}
          className="tap fast -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 text-left active:bg-surface-2"
        >
          <h2 className="text-lead masthead truncate text-ink">{format(monthCursor, "MMMM yyyy")}</h2>
          <Icon name="chevron-down" size={14} className="shrink-0 text-muted" />
        </button>
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
        {onOpenUpkeep && (
          <button
            type="button"
            onClick={onOpenUpkeep}
            aria-label="Recurring upkeep"
            className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-label text-muted active:bg-surface-2"
          >
            ···
          </button>
        )}
        {onNewEvent && (
          <button
            type="button"
            onClick={onNewEvent}
            aria-label="New event"
            className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-head text-accent active:bg-surface-2"
          >
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>

      {/* The month itself travels — swipe left is later, swipe right is earlier.
          Adjacent months peek under the finger so the gesture is the animation.
          An upward flick still expands into the last drill-in lens. */}
      <TimePager
        pageKey={format(monthCursor, "yyyy-MM")}
        onPrev={onPrev}
        onNext={onNext}
        onFlickUp={onOpenSchedule}
        peekPrev={sheet(addMonths(monthCursor, -1))}
        peekNext={sheet(addMonths(monthCursor, 1))}
      >
        {sheet(monthCursor)}
      </TimePager>
    </div>
  );
}

function MonthSheet({
  monthCursor,
  ctx,
  selected,
  weekStartsOn,
  weatherIndex,
  onPick,
  onTapEvent,
  onTapTask,
}: {
  monthCursor: Date;
  ctx: DayCtx;
  selected: Date;
  weekStartsOn: 0 | 1;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  onPick: (d: Date) => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
}) {
  const gridStart = useMemo(
    () => startOfWeek(startOfMonth(monthCursor), { weekStartsOn }),
    [monthCursor, weekStartsOn],
  );
  const cells = useMemo(() => {
    const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn });
    const out: DayPlan[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      out.push(buildDayPlan(d, ctx));
    }
    return out;
  }, [gridStart, monthCursor, ctx, weekStartsOn]);

  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(gridStart, i).toLocaleDateString([], { weekday: "short" }).slice(0, 2)),
    [gridStart],
  );

  return (
    <div>
      <div className="grid grid-cols-7 px-2">
        {weekdays.map((w, i) => (
          <div key={i} className="py-1.5 text-center text-micro font-medium uppercase text-muted">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 px-2">
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

      {/* What the marks mean — colour alone is not a legend, and a legend that
          names only some of what's on screen is worse than none: it reads as a
          complete key. So the weather row appears exactly when weather does. */}
      <div aria-hidden className="flex items-center justify-center gap-3 px-4 pt-1.5">
        <span className="flex items-center gap-1 text-micro text-muted">
          <span className="h-1 w-1 rounded-full" style={{ background: "var(--accent)" }} />
          tasks
        </span>
        <span className="flex items-center gap-1 text-micro text-muted">
          <span className="h-1 w-1 rounded-full" style={{ background: "var(--line-strong)" }} />
          events
        </span>
        {weatherIndex && weatherIndex.size > 0 && (
          <span className="flex items-center gap-1 text-micro text-muted">
            <WeatherIcon wmo={2} size={11} className="opacity-80" />
            forecast
          </span>
        )}
      </div>

      {/* The selected day's plan — month's leftover space, filled with a day's
          question, not the week's. The week crown used to sit above the grid
          and argue with a month (D-119). Only while that day is in this month,
          so the readout can't disagree with the grid on screen. */}
      {isSameMonth(selected, monthCursor) && (
        <MonthDayPreview
          day={buildDayPlan(selected, ctx)}
          onOpen={() => onPick(selected)}
          onTapEvent={onTapEvent}
          onTapTask={onTapTask}
        />
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
  const { date, isToday, timed, allDay, anytime, openMins, isPast } = day;
  const blkCount = timed.filter((t) => t.kind === "block" || t.kind === "slot").length + anytime.length;
  const evCount = timed.filter((t) => t.kind === "event").length + allDay.length;
  // Up to 3 density dots — tasks (accent) first, then events (neutral).
  const dots = [
    ...Array(blkCount).fill("block"),
    ...Array(evCount).fill("event"),
  ].slice(0, 3) as ("block" | "event")[];

  // The visible cell is a bare number; the accessible name carries the date
  // and its load so a VoiceOver swipe across the grid actually says something.
  const busy = blkCount + evCount;
  const load =
    busy === 0
      ? "free"
      : `${busy} commitment${busy === 1 ? "" : "s"}${!isPast && openMins > 0 ? `, ${fmtMins(openMins)} free` : ""}`;

  return (
    <button
      onClick={() => onPick(date)}
      aria-label={`${format(date, "EEEE, MMMM d")} — ${load}`}
      aria-current={isToday ? "date" : undefined}
      aria-pressed={isSelected}
      className={`tap fast relative flex aspect-square flex-col items-center justify-start gap-1 rounded-xl py-1.5 ${
        isSelected ? "glass-lift" : "active:bg-surface-2"
      }`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-body leading-none ${
          isToday ? "bg-accent font-semibold text-on-accent" : isSelected ? "font-semibold text-ink" : ""
        } ${!inMonth ? "text-muted/50" : isToday ? "" : "text-ink"}`}
      >
        {date.getDate()}
      </span>
      {/* Weather rides the corner; the load dots keep the slot under the
          numeral. These used to be an either/or, and because a forecast only
          exists for the week ahead, the ONE row where every day is still
          movable — the next seven — was the row that lost its busy/free signal
          entirely. Same cell position, two different meanings, on the row a
          planner reads hardest. Load is the planner's data and weather is the
          garnish, so load is the one that never gives up its place. */}
      {wx && (
        <WeatherIcon
          wmo={wx.wmo}
          size={11}
          className="pointer-events-none absolute right-0.5 top-0.5 opacity-80"
        />
      )}
      <span className="flex h-1.5 items-center gap-0.5">
        {dots.map((k, i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full"
            style={{ background: k === "block" ? "var(--accent)" : "var(--line-strong)" }}
          />
        ))}
      </span>
    </button>
  );
}

// The selected day's plan under the month grid — the space the week crown
// used to occupy, answering a day's question instead of a week's. Header
// drills into the last lens; a row opens that commitment. Caps the list so a
// packed day doesn't push the FAB off the paper.
const PREVIEW_CAP = 6;

function MonthDayPreview({
  day,
  onOpen,
  onTapEvent,
  onTapTask,
}: {
  day: DayPlan;
  onOpen: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
}) {
  const { date, timed, allDay, anytime, openMins, isPast, isBygone } = day;
  const busy = timed.length + allDay.length + anytime.length;
  const { text: readout, accent } = dayReadout(day);
  const rest = Math.max(0, timed.length + allDay.length + anytime.length - PREVIEW_CAP);
  const shownAllDay = allDay.slice(0, PREVIEW_CAP);
  const afterAllDay = PREVIEW_CAP - shownAllDay.length;
  const shownAnytime = anytime.slice(0, afterAllDay);
  const afterAnytime = afterAllDay - shownAnytime.length;
  const shownTimed = timed.slice(0, afterAnytime);

  return (
    <div className="mt-2 border-t border-line">
      <button
        onClick={onOpen}
        className="tap fast flex w-full items-center gap-2 px-4 py-3 text-left active:bg-surface-2"
      >
        <span className="text-body font-medium text-ink">
          {date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
        </span>
        {readout && (
          <span className="mono text-label" style={{ color: accent ? "var(--accent)" : "var(--muted)" }}>
            {readout}
          </span>
        )}
        <span className="ml-auto text-muted">→</span>
      </button>

      {busy === 0 ? (
        <p className="px-4 pb-3 text-body text-muted">
          {isBygone ? "Nothing scheduled." : isPast ? "Done for today." : "No commitments — wide open."}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5 px-4 pb-3">
          {shownAllDay.map((e) => (
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
                  accountId: e.account_id,
                  calendarId: e.calendar_id,
                })
              }
              className="tap fast -mx-1 flex items-baseline gap-2.5 rounded-lg px-1 py-1.5 text-left active:bg-surface-2"
            >
              <span className="mono w-[68px] shrink-0 text-right text-meta text-muted">all day</span>
              <span className="min-w-0 truncate text-body text-ink">{e.title || "Busy"}</span>
            </button>
          ))}
          {shownAnytime.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTapTask?.(t.id)}
              className="tap fast -mx-1 flex items-baseline gap-2.5 rounded-lg px-1 py-1.5 text-left active:bg-surface-2"
            >
              <span className="mono w-[68px] shrink-0 text-right text-meta text-accent">anytime</span>
              <span className="min-w-0 truncate text-body text-accent">{t.title}</span>
            </button>
          ))}
          {shownTimed.map((b, i) => {
            const isSlot = b.kind === "slot";
            const tap: CalendarTap =
              b.kind === "event"
                ? { kind: "event", id: b.eventId!, title: b.title || "Untitled", start: b.start, end: b.end, location: b.location ?? null, self_rsvp: b.self_rsvp, accountId: b.accountId, calendarId: b.calendarId }
                : isSlot
                  ? { kind: "slot", slot: b.slot!, title: b.title || "Untitled", start: b.start, end: b.end, childCount: b.childCount ?? 0, doneCount: b.doneCount ?? 0 }
                  : { kind: "block", taskId: b.taskId!, title: b.title || "Untitled", start: b.start, end: b.end, done: !!b.done };
            const mark = isSlot ? "var(--slot)" : b.kind === "block" ? "var(--accent)" : "var(--line-strong)";
            return (
              <button
                key={i}
                onClick={() => onTapEvent?.(tap)}
                className="tap fast -mx-1 flex items-baseline gap-2.5 rounded-lg px-1 py-1.5 text-left active:bg-surface-2"
              >
                <span className="mono w-[68px] shrink-0 text-right text-meta" style={{ color: mark }}>
                  {at(b.start)}
                </span>
                <span className={`min-w-0 truncate text-body ${b.done ? "text-muted line-through" : "text-ink"}`}>
                  {b.title || "Untitled"}
                </span>
              </button>
            );
          })}
          {rest > 0 && (
            <button
              onClick={onOpen}
              className="tap fast py-1.5 text-left text-label text-muted active:opacity-70"
            >
              +{rest} more
            </button>
          )}
          {!isPast && !isBygone && openMins > 0 && busy > 0 && (
            <p className="pt-1 text-label text-muted">{fmtMins(openMins)} still open</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Schedule (agenda) ──────────────────────────────────────────────────────
// An availability list that opens ON the anchor day (today by default): it is the
// first row, so the list simply starts at the top on it — no scroll math, nothing
// to race on first load. Forward runs the 14-day horizon; the past is revealed
// upward on demand via "Earlier days" at the top, which surfaces recent history
// (most-recent day under the sticky bars, older above, today below).
// Exported for the ?daycal verify harness only — it is prop-driven, so the
// harness can drive it over fixtures beside the Day lens.
export function ScheduleView({
  anchor,
  ctx,
  weatherIndex,
  loading,
  pastDays,
  onLoadEarlier,
  onTapEvent,
  onTapTask,
  onBack,
  onDayLens,
  onJumpTo,
  onNewEvent,
}: {
  anchor: Date;
  ctx: DayCtx;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  loading: boolean;
  pastDays: number;
  onLoadEarlier: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
  onBack: () => void;
  onDayLens: (topDay: Date) => void;
  /** Jump the schedule's anchor to an arbitrary date (the header's picker).
   *  Optional so the ?daycal harness keeps working unchanged. */
  onJumpTo?: (d: Date) => void;
  onNewEvent?: () => void;
}) {
  const days = useMemo<DayPlan[]>(() => {
    const start = addDays(startOfDay(anchor), -pastDays);
    const total = pastDays + HORIZON_DAYS;
    return Array.from({ length: total }, (_, i) => buildDayPlan(addDays(start, i), ctx));
  }, [anchor, pastDays, ctx]);

  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stripPrevWidth = useRef<number | null>(null);
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  // Stable ref callbacks per day key — DayCard is memoized (it was the single
  // most expensive component in the app), and an inline closure here would
  // hand every card a fresh prop each render, defeating the memo.
  const dayRefFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const innerRefFor = (key: string) => {
    let fn = dayRefFns.current.get(key);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        dayRefs.current[key] = el;
      };
      dayRefFns.current.set(key, fn);
    }
    return fn;
  };

  const jumpTo = (key: string) => {
    dayRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Revealing history (WebKit has no `overflow-anchor`) ──────────────────
  // The schedule opens on the anchor day as the first row, so first-load needs no
  // scroll math — the list simply starts at the top. The only scroll we manage by
  // hand is the "earlier" prepend: when we add days *above* the current top, we
  // hold that prior top day at its place so the new days arrive above the fold
  // instead of yanking the list down. We keep the hold for a beat because the
  // freshly-fetched days fill in their heights asynchronously; the user's first
  // scroll gesture releases it so we never fight a real drag.
  const hold = useRef<{ key: string; offset: number } | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const releaseHold = () => {
    hold.current = null;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
  };

  useLayoutEffect(() => {
    const h = hold.current;
    if (!h) return;
    const scroller = scrollParent(rootRef.current);
    const el = dayRefs.current[h.key];
    if (!scroller || !el) return;
    const cur = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const delta = cur - h.offset;
    if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    // Debounced release: every height change (fetched days filling in) pushes the
    // release out, so we let go only after ~1s of layout quiet.
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      hold.current = null;
    }, 1000);
  }, [days, loading]);

  // A real scroll gesture ends the hold immediately. (Programmatic scrollTop
  // writes fire only `scroll`, which we don't listen for, so it can't self-cancel.)
  useEffect(() => {
    const scroller = scrollParent(rootRef.current);
    if (!scroller) return;
    const events = ["wheel", "touchstart", "pointerdown", "keydown"];
    for (const e of events) scroller.addEventListener(e, releaseHold, { passive: true });
    return () => {
      for (const e of events) scroller.removeEventListener(e, releaseHold);
    };
  }, []);

  // Keep the date strip showing the same span after an "earlier" prepend adds
  // chips on its left, so it doesn't jump to the oldest day. Chips are fixed-width
  // (no async fill), so a one-shot width-delta correction suffices.
  useLayoutEffect(() => {
    if (stripPrevWidth.current == null) return;
    const el = stripRef.current;
    if (el) {
      const added = el.scrollWidth - stripPrevWidth.current;
      if (added > 0) el.scrollLeft += added;
    }
    stripPrevWidth.current = null;
  }, [days]);

  // Reveal more history. Park the newly-loaded block's most-recent day just under
  // the sticky bars — so the tap visibly surfaces recent history (that day at the
  // top, older days above it, today below), and the hold keeps it there while the
  // fetched days fill in their heights.
  const loadEarlier = () => {
    if (days.length) hold.current = { key: dayKey(addDays(days[0].date, -1)), offset: REVEAL_OFFSET };
    if (stripRef.current) stripPrevWidth.current = stripRef.current.scrollWidth;
    onLoadEarlier();
  };

  // The day you're actually looking at — the first day section still on screen
  // under the sticky bars — so switching to the Day lens keeps your place.
  const topDay = (): Date => {
    const scroller = scrollParent(rootRef.current);
    const top = scroller?.getBoundingClientRect().top ?? 0;
    for (const d of days) {
      const el = dayRefs.current[dayKey(d.date)];
      if (el && el.getBoundingClientRect().bottom - top > REVEAL_OFFSET) return d.date;
    }
    return anchor;
  };

  return (
    <div ref={rootRef}>
      {/* Back header — pops to the month grid and names where you'll land; the
          pill switches to the Day lens on the day you're scrolled to. The
          timezone chip names the clock these times are in (and flags travel). */}
      {/* Six controls on a 375px row — back · jump · lens · zone · new. It is
          over-subscribed by ~30px, and flexbox pays for that by wrapping the
          month name onto two lines, which reads like a broken header. `gap-1`
          and a nowrap label spend the difference: the label truncates as a last
          resort rather than folding. */}
      <div className="sticky top-0 z-20 flex items-center gap-1 border-b border-line bg-surface/90 pr-2 backdrop-blur">
        <button
          onClick={onBack}
          className="tap fast flex min-w-0 items-center gap-0.5 px-2 py-2.5 text-body font-medium text-accent active:opacity-70"
        >
          <span className="text-head leading-none">‹</span>
          <span className="truncate whitespace-nowrap">{format(anchor, "MMM yyyy")}</span>
        </button>
        <div className="flex-1" />
        {onJumpTo && (
          // A date jump — reaching "three Tuesdays ago" used to cost repeated
          // "Earlier days" taps plus a long scroll. The OS date picker reaches
          // any date in a couple of taps.
          //
          // The input is `sr-only` and the BUTTON opens it (`showPicker`, the
          // same idiom `PlacementBand` and `InlineDate` already use). It used to
          // be a transparent full-size input laid over the glyph, and iOS paints
          // a date control's own value while its picker is open — at the
          // control's intrinsic width, which is twice this 44px button. So
          // "Aug 17," smeared across the header behind the calendar glyph every
          // time you opened it. Nothing is left to paint now.
          <DateJump anchor={anchor} onJumpTo={onJumpTo} />
        )}
        <CalLensPill lens="schedule" onLens={(l) => l === "day" && onDayLens(topDay())} />
        <TimeZoneChip now={ctx.now} />
        {onNewEvent && (
          <button
            type="button"
            onClick={onNewEvent}
            aria-label="New event"
            className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-head text-accent active:bg-surface-2"
          >
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>

      {/* Date strip — tap a day to jump to it. Past days read muted. */}
      <div className="sticky top-[45px] z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div ref={stripRef} className="mobile-scroll flex gap-1.5 overflow-x-auto px-3 py-2.5">
          {days.map((d) => {
            const key = dayKey(d.date);
            const busyDay = d.timed.length > 0 || d.allDay.length > 0 || d.anytime.length > 0;
            const dateStr = d.date.toLocaleDateString("en-CA");
            const wx = weatherIndex?.get(dateStr);
            return (
              <button
                key={key}
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

      {loading && days.every((d) => d.timed.length === 0 && d.allDay.length === 0 && d.anytime.length === 0) ? (
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
              innerRef={innerRefFor(dayKey(d.date))}
              onTapEvent={onTapEvent}
              onTapTask={onTapTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One day: header with a free/busy read, the day's events, and — the point of
// this whole view — its open windows spelled out so you can answer on the spot.
// Memoized: 21 of these render per agenda, and the audit measured this as the
// single most expensive component anywhere in the app — a parent re-render
// with unchanged plans must not re-render every card.
const DayCard = memo(function DayCard({
  day,
  innerRef,
  onTapEvent,
  onTapTask,
}: {
  day: DayPlan;
  innerRef: (el: HTMLElement | null) => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
}) {
  const { date, isToday, label, allDay, anytime, timed, gaps, isPast, isBygone } = day;
  const fullyOpen = timed.length === 0 && allDay.length === 0 && anytime.length === 0;

  // A past date is a record of what happened, not an availability question —
  // its readout counts commitments and it never advertises open windows.
  const { text: readout, accent: readoutAccent } = dayReadout(day);

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
                  accountId: e.account_id,
                  calendarId: e.calendar_id,
                })
              }
              className="tap fast mono rounded-md border border-line bg-surface-2 px-2 py-0.5 text-label text-muted active:bg-surface"
            >
              {e.title || "Busy"}
            </button>
          ))}
        </div>
      )}

      {/* Anytime — planned for the day, no clock. Same chips the desktop
          all-day row shows; without them a ＋ capture from this tab vanished. */}
      {anytime.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {anytime.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTapTask?.(t.id)}
              className="tap fast rounded-md border border-accent/40 bg-accent-soft px-2 py-1.5 text-label font-medium text-accent active:bg-accent/15"
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      {/* Timed commitments */}
      {timed.length > 0 && (
        <div className="space-y-1.5">
          {timed.map((b, i) => {
            const isSlot = b.kind === "slot";
            const tap: CalendarTap =
              b.kind === "event"
                ? { kind: "event", id: b.eventId!, title: b.title || "Untitled", start: b.start, end: b.end, location: b.location ?? null, self_rsvp: b.self_rsvp, accountId: b.accountId, calendarId: b.calendarId }
                : isSlot
                  ? { kind: "slot", slot: b.slot!, title: b.title || "Untitled", start: b.start, end: b.end, childCount: b.childCount ?? 0, doneCount: b.doneCount ?? 0 }
                  : { kind: "block", taskId: b.taskId!, title: b.title || "Untitled", start: b.start, end: b.end, done: !!b.done };
            const markColor = isSlot ? "var(--slot)" : b.kind === "block" ? "var(--accent)" : "var(--line-strong)";
            // A slot is a container, not a single commitment — it gets the
            // same dashed teal wash the Day lens draws for it, so tasks
            // riding inside one don't read as a bare timestamped row.
            return (
              <button
                key={i}
                onClick={() => onTapEvent?.(tap)}
                className={`tap fast -mx-1 flex w-full items-baseline gap-2.5 rounded-lg px-1 text-left active:bg-surface-2 ${
                  isSlot ? "border py-1" : ""
                }`}
                style={
                  isSlot
                    ? {
                        background: "color-mix(in srgb, var(--slot) 14%, transparent)",
                        borderColor: "color-mix(in srgb, var(--slot) 45%, var(--line))",
                        borderStyle: "dashed",
                      }
                    : undefined
                }
              >
                <span className="mono w-[68px] shrink-0 text-right text-meta" style={{ color: markColor }}>
                  {at(b.start)}
                </span>
                <span
                  className={`mt-[5px] shrink-0 self-start ${isSlot || b.projectBacked ? "h-2 w-2 rounded-[2px]" : "h-1.5 w-1.5 rounded-full"}`}
                  style={{ background: markColor }}
                />
                <div className="min-w-0 flex-1">
                  {/* A sitting held for a project says so, in the same words the
                      Schedule and Plan the week use (`blockDesignation`) — the
                      `▸` it wore is a glyph you'd have to be taught. */}
                  {isSlot && b.projectBacked && (
                    <div
                      className="truncate text-micro font-semibold uppercase leading-none"
                      style={{ color: "var(--slot)", letterSpacing: "0.06em" }}
                    >
                      {blockDesignation({ kind: "project" })}
                    </div>
                  )}
                  <div className={`flex min-w-0 items-center gap-1.5 ${isSlot && b.projectBacked ? "mt-[3px]" : ""}`}>
                    <div className={`min-w-0 truncate text-body ${b.done ? "text-muted line-through" : "text-ink"}`}>
                      {b.projectBacked && !isSlot ? `▸ ${b.title || "Untitled"}` : b.title || "Untitled"}
                    </div>
                    {isSlot && (b.childCount ?? 0) > 0 && (
                      <span
                        className="mono ml-auto shrink-0 rounded-full px-1.5 text-micro leading-snug text-muted"
                        style={{ background: "var(--bg)" }}
                      >
                        {b.doneCount}/{b.childCount}
                      </span>
                    )}
                  </div>
                  <div className="mono text-meta text-muted">
                    {at(b.start)}–{at(b.end)}
                    {b.location ? ` · ${b.location}` : ""}
                  </div>
                  {isSlot && (b.children?.length ?? 0) > 0 && (
                    <div className="mt-0.5 truncate text-meta text-muted">
                      {b.children!.map((c) => c.title).join(" · ")}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Open windows — the availability answer. A bygone day is history, so we
          don't offer to fill windows that have already elapsed. */}
      {!isPast && !isBygone && gaps.length > 0 && (
        <div className={timed.length > 0 || allDay.length > 0 || anytime.length > 0 ? "mt-3" : ""}>
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
});
