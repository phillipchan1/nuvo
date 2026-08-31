// The mobile Calendar's surface — one chrome, five bodies, two axes of motion.
//
// This is the state machine and the composition; `MobileCalendar` is the data
// wrapper around it, and `CalendarHarness` (?horizon) mounts this same
// component over fixtures. The lenses themselves render only their BODY: the
// horizon ladder, travel, the seven columns and the week's crown are mounted
// here, exactly once, and never unmount when the horizon changes. That is what
// makes them a place to stand rather than five headers that resemble each
// other. The hero is the same object one level up — it is *handed* to the app's
// top bar (`onHero`) rather than drawn in a row of its own, so it costs no
// vertical space and cannot restate the crown strip under it (D-125).
//
// Two axes, two motions, no overlap:
//   travel  same horizon, next date  → `TimePager`, inside each body
//   zoom    same date, next horizon  → `LensZoom`, around every body
//
// Leaning in and standing back used to be an instant swap in which the title,
// the second band, the crown and the whole body all changed at once. Now the
// only thing that moves is the body, scaling through the column of the day you
// are standing on — the same column the week row above it occupies.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  format,
  getDay,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { indexWeather } from "../../hooks/useWeather";
import type { RenderCrownTask } from "../../hooks/useWeekCrown";
import { parseDateISO } from "../../lib/dates";
import { clearCalendarReveal, onCalendarReveal, pendingCalendarReveal } from "../../lib/calendarReveal";
import type { CalendarTap } from "./MobileEventSheet";
import { buildDayPlan, dayReadout, scrollParent, type DayCtx } from "./dayPlan";
import {
  CalendarHeader,
  LensZoom,
  WeekRow,
  WeekdayLetters,
  zoomDir,
  type CalHero,
  type CalHorizon,
} from "./CalendarChrome";
// The month grid's tap meaning, and "keep the selection when the month moves",
// live in one tested module — not re-decided here (D-121).
import { clampDayToMonth, monthDayIntent } from "./monthTap";
import MobileMonthView from "./MobileMonthView";
import MobileAgendaView, { AGENDA_DAYS } from "./MobileAgendaView";
import MobileDayView from "./MobileDayView";
import MobileWeekView from "./MobileWeekView";
import MobileYearView from "./MobileYearView";
import MobileWeekCrown from "./MobileWeekCrown";

const MODE_KEY = "nuvo-mobile-cal-mode";
/** Days of history the agenda's "Earlier days" control reveals per tap. */
const PAST_STEP = 14;
/** Roughly the height of the shut crown strip, for the bodies' scroll offsets.
 *  Exact to the pixel doesn't matter: it decides where a day header parks under
 *  the sticky stack, and the crown is only NOT sticky while it's expanded —
 *  which is when you're reading projects, not hunting for a day. */
const CROWN_STRIP_PX = 34;

/** Where the calendar is standing. Lifted into a named shape because the data
 *  wrapper needs it to size its fetch window, and the harness needs to be able
 *  to ignore it. */
export interface CalWindow {
  mode: CalHorizon;
  selected: Date;
  monthCursor: Date;
  yearCursor: number;
  pastDays: number;
}

function readMode(): CalHorizon {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "month" || v === "schedule" || v === "day" || v === "week" || v === "year") return v;
  } catch {
    /* ignore */
  }
  return "month";
}

/**
 * What ONE step of travel changes — a swipe, or a tap of ‹ ›.
 *
 * Pure, and exported, because two places need it and they must never disagree:
 * the surface applies it to actually move, and the data wrapper applies it to
 * work out which windows to warm so that the move has nothing to wait for
 * (D-123). Written as a whole-window transform rather than a patch so the
 * wrapper can hand the result straight back to the range function.
 *
 * Week-start is deliberately not a parameter: stepping seven days preserves
 * where in the week you were standing, so which day a week opens on is a
 * question for whoever draws it, not for travel.
 */
export function stepCalendarWindow(win: CalWindow, delta: -1 | 1): CalWindow {
  const { mode, selected, monthCursor, yearCursor } = win;
  if (mode === "year") return { ...win, yearCursor: yearCursor + delta };
  if (mode === "month") {
    // Paging a month carries the selection with it, clamped (Aug 31 → Feb 28),
    // or the plan under the grid goes blank the moment you page (D-121).
    const next = startOfMonth(addMonths(monthCursor, delta));
    return { ...win, monthCursor: next, selected: clampDayToMonth(selected, next) };
  }
  // Day steps a day; week and agenda step a week.
  const d = startOfDay(addDays(selected, mode === "day" ? delta : delta * 7));
  return { ...win, selected: d, monthCursor: startOfMonth(d), pastDays: 0 };
}

/** The window the surface opens on — shared with the data wrapper so its first
 *  fetch asks for the span the first render will actually draw. */
export function initialCalendarWindow(now: Date, initialMode?: CalHorizon): CalWindow {
  return {
    mode: initialMode ?? readMode(),
    selected: startOfDay(now),
    monthCursor: startOfMonth(now),
    yearCursor: now.getFullYear(),
    pastDays: 0,
  };
}

export default function CalendarSurface({
  now,
  ctx,
  loading,
  weekStartsOn,
  weatherIndex,
  initialMode,
  onWindowChange,
  onTapEvent,
  onTapTask,
  onHero,
  onOpenProject,
  renderCrownTask,
  onPlanWeek,
}: {
  now: Date;
  ctx: DayCtx;
  loading: boolean;
  weekStartsOn: 0 | 1;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  /** Harnesses pin a lens without writing `nuvo-mobile-cal-mode`. */
  initialMode?: CalHorizon;
  /** Reports where the calendar is standing, so the wrapper can fetch for it. */
  onWindowChange?: (w: CalWindow) => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
  /** Where the hero goes: the app's top bar owns it, not this chrome (D-125).
   *  Called whenever the span or its one fact changes, and with `null` on the
   *  way out so the host's bar doesn't keep a stale span. */
  onHero?: (h: CalHero | null) => void;
  /** The crown's doors — omit any and the crown stays off (harnesses, embeds). */
  onOpenProject?: (id: string) => void;
  renderCrownTask?: RenderCrownTask;
  onPlanWeek?: () => void;
}) {
  const persistMode = initialMode == null;
  const [win, setWin] = useState<CalWindow>(() => initialCalendarWindow(now, initialMode));
  const { mode, selected, monthCursor, yearCursor, pastDays } = win;

  const weekOpts = useMemo(() => ({ weekStartsOn }), [weekStartsOn]);

  const move = (patch: Partial<CalWindow>) => setWin((w) => ({ ...w, ...patch }));

  // Reporting where we're standing, and remembering the rung, are effects — not
  // work done inside the state updater, which StrictMode runs twice and React
  // runs during render.
  const report = useRef(onWindowChange);
  report.current = onWindowChange;
  useEffect(() => {
    report.current?.(win);
  }, [win]);
  useEffect(() => {
    if (!persistMode) return;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode, persistMode]);

  // The hero is handed to the top bar rather than drawn (D-125). The jump is
  // wrapped once so its identity never changes — the host holds the hero object
  // in state, and a fresh callback every render would be a render loop.
  const jumpRef = useRef<(d: Date) => void>(() => {});
  const stableJump = useCallback((d: Date) => jumpRef.current(d), []);
  const heroSink = useRef(onHero);
  heroSink.current = onHero;

  // The last drill-in lens — where a second tap on a month day lands you.
  // Month and Year are stand-backs, so neither can ever be the answer: landing
  // a day tap on one would zoom away from the day you just tapped.
  const drill = useRef<Exclude<CalHorizon, "month" | "year">>(
    mode === "month" || mode === "year" ? "schedule" : mode,
  );

  // ── the zoom ──────────────────────────────────────────────────────────────
  // Direction is decided when the horizon changes; the origin is the column of
  // the selected day, so the motion emanates from the same seven columns the
  // week row holds in the chrome above.
  const prevMode = useRef(mode);
  const dir = useRef<ReturnType<typeof zoomDir>>(null);
  if (prevMode.current !== mode) {
    dir.current = zoomDir(prevMode.current, mode);
    prevMode.current = mode;
  }
  const col = (getDay(selected) - weekStartsOn + 7) % 7;
  const zoomOrigin = `${((col + 0.5) / 7) * 100}% 0%`;

  // A horizon change lands you at the top of the new one. Without this, leaning
  // out of a day you had scrolled to 6pm dropped you into a month grid at a
  // scroll offset it doesn't even have. The bodies' own "park the now line"
  // scroll runs a frame later (see MobileDayView), so it still wins where it
  // should.
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollAt = useRef(mode);
  useLayoutEffect(() => {
    if (scrollAt.current === mode) return;
    scrollAt.current = mode;
    const scroller = scrollParent(rootRef.current);
    if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
  }, [mode]);

  // The sticky stack's height, so a day header parks just under it rather than
  // behind it. Measured rather than hardcoded: the chrome is two rows plus a
  // band whose height depends on the lens.
  const chromeRef = useRef<HTMLDivElement>(null);
  const [chromePx, setChromePx] = useState(112);
  useLayoutEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const measure = () => setChromePx(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── where a lens is anchored ─────────────────────────────────────────────
  const weekStart = useMemo(() => startOfWeek(startOfDay(selected), weekOpts), [selected, weekOpts]);
  const weekScoped = mode === "day" || mode === "week" || mode === "schedule";
  const plan = useMemo(
    () => (mode === "day" ? buildDayPlan(selected, ctx) : null),
    [mode, selected, ctx],
  );

  // ── selecting, leaning, travelling ───────────────────────────────────────

  const selectDay = (date: Date) => {
    const d = startOfDay(date);
    move({ selected: d, monthCursor: startOfMonth(d), pastDays: 0 });
  };

  /** Lean in on a day — from the month grid, or from the week's day headers. */
  const openDay = (date: Date, lens: Exclude<CalHorizon, "month" | "year"> = drill.current) => {
    drill.current = lens;
    const d = startOfDay(date);
    move({ selected: d, monthCursor: startOfMonth(d), pastDays: 0, mode: lens });
  };

  /** Opening a day FROM THE MONTH always lands on Day — they pointed at a day,
   *  not a week — and deliberately does not overwrite `drill`, so the upward
   *  flick still expands into whichever lens you actually live in (D-121). */
  const openMonthDay = (date: Date) => {
    const d = startOfDay(date);
    move({ selected: d, monthCursor: startOfMonth(d), pastDays: 0, mode: "day" });
  };

  /** Lean in on a whole row of the month grid — the door in its left gutter.
   *  Lands on today when today is in that week, so the commonest case opens
   *  where you already are rather than on a Sunday you didn't ask about. */
  const openWeek = (weekStart: Date) => {
    drill.current = "week";
    const inWeek = startOfWeek(startOfDay(now), weekOpts).getTime() === weekStart.getTime();
    const d = inWeek ? startOfDay(now) : startOfDay(weekStart);
    move({ selected: d, monthCursor: startOfMonth(d), pastDays: 0, mode: "week" });
  };

  /** Move to a horizon. Leaning in from a stand-back lens has to land on a day
   *  that is actually IN the span you were looking at — you were reading
   *  September, so "W" must not open a week in August because that is where the
   *  selection happened to be left. */
  const setHorizon = (h: CalHorizon) => {
    if (h === mode) return;
    if (h !== "month" && h !== "year") drill.current = h;
    const patch: Partial<CalWindow> = { mode: h, pastDays: 0 };
    if (h === "year") {
      patch.yearCursor = monthCursor.getFullYear();
    } else if (h === "month") {
      patch.monthCursor = startOfMonth(selected);
    } else if (mode === "month" && !isSameMonth(selected, monthCursor)) {
      const landing = isSameMonth(now, monthCursor) ? startOfDay(now) : startOfMonth(monthCursor);
      patch.selected = landing;
    } else if (mode === "year") {
      const m = new Date(yearCursor, monthCursor.getMonth(), 1);
      const landing = isSameMonth(now, m) ? startOfDay(now) : m;
      patch.selected = startOfDay(landing);
      patch.monthCursor = startOfMonth(landing);
    }
    move(patch);
  };

  /** ‹ › travel one unit of whatever horizon you're on — the same direction
   *  grammar as the swipe (earlier is right/‹, later is left/›). */
  // One definition of travel, shared with the prefetcher — see
  // `stepCalendarWindow`.
  const travel = (delta: -1 | 1) => setWin((w) => stepCalendarWindow(w, delta));

  // Today does two things, which is why it can be permanent rather than
  // appearing only when it has a date to change: it brings the span back to
  // today, AND it asks the canvas to re-park on now. On the current span only
  // the second happens, so the control still answers instead of sitting dead.
  const [recenter, setRecenter] = useState(0);
  const goToday = () => {
    const t = startOfDay(now);
    move({
      selected: t,
      monthCursor: startOfMonth(t),
      yearCursor: now.getFullYear(),
      pastDays: 0,
    });
    setRecenter((n) => n + 1);
  };

  const jumpTo = (d: Date) => {
    const day = startOfDay(d);
    move({
      selected: day,
      monthCursor: startOfMonth(day),
      yearCursor: day.getFullYear(),
      pastDays: 0,
    });
  };
  jumpRef.current = jumpTo;

  // "Take me to that day" — landing here from a calendar search hit. The bus
  // rather than a prop, for the reason in lib/calendarReveal.ts; and the
  // pending drain matters more here than on the desktop, because search
  // *switches tabs* and this mounts a frame after the publish.
  useLayoutEffect(() => {
    const go = (dateISO: string) => {
      const d = startOfDay(parseDateISO(dateISO));
      // Day is the only lens that shows a specific moment; a month grid that
      // merely scrolled would leave you hunting for what you searched for.
      drill.current = "day";
      move({ selected: d, monthCursor: startOfMonth(d), yearCursor: d.getFullYear(), pastDays: 0, mode: "day" });
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

  // ── the hero: one Fraunces word for the span, one mono fact about it ──────
  const hero = (): { hero: string; fact?: string; accent?: boolean } => {
    if (mode === "year") return { hero: String(yearCursor) };
    if (mode === "month") {
      return { hero: format(monthCursor, "MMMM"), fact: format(monthCursor, "yyyy") };
    }
    if (mode === "week") {
      const end = addDays(weekStart, 6);
      const span =
        format(weekStart, "MMM d") +
        " – " +
        format(end, format(weekStart, "MMM") === format(end, "MMM") ? "d" : "MMM d");
      const nowWeek = startOfWeek(startOfDay(now), weekOpts);
      const weeks = Math.round((weekStart.getTime() - nowWeek.getTime()) / (7 * 86_400_000));
      const label =
        weeks === 0 ? "This week" : weeks === 1 ? "Next week" : weeks === -1 ? "Last week" : span;
      return { hero: label, fact: label === span ? undefined : span };
    }
    if (mode === "schedule") {
      return {
        hero: "Agenda",
        fact:
          format(selected, "MMM d") + " – " + format(addDays(selected, AGENDA_DAYS - 1), "MMM d"),
      };
    }
    // Day — the day named once, and its one read.
    //
    // This used to be `Today` + `Aug 27 · done for today`, under a global top
    // bar already printing `Thu Aug 27`, above a week row drawing 27 as the lit
    // cell: the same date three times inside 100px of the most contested screen
    // in the app. So the hero *is* the identification and the fact is purely the
    // read. `Today` / `Tomorrow` / `Yesterday` pin a day absolutely, so they
    // stand alone; any other day names its date, since a bare weekday pins
    // nothing — and neither needs the weekday spelled out, because the row
    // underneath draws it as the lit column (D-123).
    const p = plan ?? buildDayPlan(selected, ctx);
    const read = dayReadout(p);
    const midnight = startOfDay(now);
    const pinned = [0, 1, -1].some((n) => isSameDay(selected, addDays(midnight, n)));
    return {
      hero: pinned ? p.label : format(selected, "MMMM d"),
      fact: read.text || undefined,
      accent: read.accent,
    };
  };
  const h = hero();

  const heroDate = mode === "year" ? null : selected;
  useEffect(() => {
    heroSink.current?.({
      hero: h.hero,
      fact: h.fact,
      factAccent: h.accent,
      date: heroDate,
      onJump: stableJump,
    });
  }, [h.hero, h.fact, h.accent, heroDate, stableJump]);
  // Leaving the tab must clear the bar, or it keeps a span nothing is showing.
  useEffect(() => () => heroSink.current?.(null), []);

  const onCurrentSpan =
    mode === "year"
      ? yearCursor === now.getFullYear()
      : mode === "month"
        ? isSameMonth(monthCursor, now)
        : mode === "week"
          ? isSameDay(weekStart, startOfWeek(startOfDay(now), weekOpts))
          : isSameDay(selected, startOfDay(now));

  const travelUnit =
    mode === "year" ? "year" : mode === "month" ? "month" : mode === "day" ? "day" : "week";

  const crownMounted = !!(onOpenProject && renderCrownTask && onPlanWeek);
  const stickyPx = chromePx + (crownMounted ? CROWN_STRIP_PX : 0);

  const body = () => {
    if (mode === "year") {
      return (
        <MobileYearView
          year={yearCursor}
          now={now}
          weekStartsOn={weekStartsOn}
          onPrev={() => travel(-1)}
          onNext={() => travel(1)}
          onPickMonth={(m) => {
            // Landing in the month you tapped: today if it lives there,
            // otherwise carry the day you had, clamped into it.
            const next = startOfMonth(m);
            const landing = isSameMonth(now, m) ? startOfDay(now) : clampDayToMonth(selected, next);
            move({ mode: "month", monthCursor: next, selected: landing });
          }}
        />
      );
    }
    if (mode === "month") {
      return (
        <MobileMonthView
          monthCursor={monthCursor}
          ctx={ctx}
          selected={selected}
          weekStartsOn={weekStartsOn}
          weatherIndex={weatherIndex}
          onPrev={() => travel(-1)}
          onNext={() => travel(1)}
          // First tap reads the day (the plan under the grid answers it without
          // leaving the month); a second tap, or the preview's own header,
          // leans in. Tapping a day used to drill instantly, which meant the
          // day's plan under the grid could only ever show TODAY. The rule
          // itself lives in `monthTap.ts` so it can be tested without mounting
          // a calendar — never re-decide select-vs-open in a surface.
          onPick={(d) => (monthDayIntent(selected, d) === "open" ? openMonthDay(d) : selectDay(d))}
          onOpenDay={openMonthDay}
          onOpenWeek={openWeek}
          onFlickUp={() => openDay(selected)}
          onTapEvent={onTapEvent}
          onTapTask={onTapTask}
        />
      );
    }
    if (mode === "week") {
      return (
        <MobileWeekView
          weekStart={weekStart}
          ctx={ctx}
          loading={loading}
          stickyPx={stickyPx}
          onPrev={() => travel(-1)}
          onNext={() => travel(1)}
          onTapEvent={onTapEvent}
          recenter={recenter}
        />
      );
    }
    if (mode === "day") {
      return (
        <MobileDayView
          selected={selected}
          ctx={ctx}
          loading={loading}
          stickyPx={stickyPx}
          onPrev={() => travel(-1)}
          onNext={() => travel(1)}
          onTapEvent={onTapEvent}
          onTapTask={onTapTask}
          recenter={recenter}
        />
      );
    }
    return (
      <MobileAgendaView
        anchor={selected}
        ctx={ctx}
        loading={loading}
        stickyPx={stickyPx}
        pastDays={pastDays}
        onLoadEarlier={() => move({ pastDays: pastDays + PAST_STEP })}
        onTapEvent={onTapEvent}
        onTapTask={onTapTask}
      />
    );
  };

  return (
    <div ref={rootRef} className="fab-clear" style={{ ["--cal-chrome" as string]: `${chromePx}px` }}>
      {/* ── the chrome: mounted once, never unmounted by a horizon change ──── */}
      <div
        ref={chromeRef}
        className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur"
      >
        <CalendarHeader
          horizon={mode}
          onHorizon={setHorizon}
          travelUnit={travelUnit}
          onPrev={() => travel(-1)}
          onNext={() => travel(1)}
          onToday={goToday}
          onCurrentSpan={onCurrentSpan}
          now={now}
        />
        {/* Seven columns, in the same place at every horizon that has them: the
            month's letters, or the week the selected day sits in. The row is
            the persistent object the zoom is anchored on. */}
        {mode === "month" ? (
          <WeekdayLetters weekStartsOn={weekStartsOn} />
        ) : weekScoped ? (
          <WeekRow
            weekStart={weekStart}
            selected={selected}
            ctx={ctx}
            weatherIndex={weatherIndex}
            // Tapping a day in the row means the same thing at every rung:
            // "that day". On the Day lens it shows it; on Week it leans in; on
            // the agenda it re-anchors the list to it.
            onPick={mode === "week" ? (d) => openDay(d, "day") : selectDay}
          />
        ) : null}
      </div>

      {/* ── the anchor: what this week is carrying, at every horizon ─────────
          Shut it is one line of pips, and it rides sticky just under the
          chrome, so the answer to "what am I carrying" never scrolls away and
          never disappears when you stand back to the month. Expanded — the
          week's projects and their work — it belongs to the week-scoped
          lenses, and it is not sticky, because that is a page you read. */}
      {crownMounted && (
        <MobileWeekCrown
          now={now}
          onOpenProject={onOpenProject!}
          renderTask={renderCrownTask!}
          onOpenDay={(d) => openDay(d, "day")}
          onPlanWeek={onPlanWeek!}
          anchored
          // Month and Year answer a different question (D-119), so the slate
          // cannot open over them; the strip stays, because it is the one line
          // that says what week you are in the middle of.
          expandable={weekScoped}
          onExpandElsewhere={() => setHorizon("week")}
        />
      )}

      <LensZoom zoomKey={mode} dir={dir.current} origin={zoomOrigin}>
        {body()}
      </LensZoom>
    </div>
  );
}
