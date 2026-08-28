// The mobile Calendar's chrome — the parts that DON'T change when you change
// horizon.
//
// Every lens used to build its own: the month wore a Fraunces masthead with
// ‹ › and a ⋯, the three drill-in lenses wore a `‹ Aug 2026` back button plus a
// 28-chip scroller plus their own day/week header, and the year wore a
// `‹ Month`. Five header shapes, four second bands, and four separate ways to
// change horizon (tap the month title for the year, tap a day to drill in, tap
// the back chevron to return, tap a pill to move between List/Day/Week). So the
// single most disorienting act in the app — standing back or leaning in — was
// also the one where every fixed point on the screen moved at once, instantly.
//
// Now there is one chrome, mounted ONCE (by `CalendarLenses`), and the lenses
// render only their bodies underneath it:
//
//   row A   the hero — the span you are looking at, and its one fact
//   row B   the horizon ladder (☰ · D W M Y) and travel at that horizon
//   band    seven columns: the month's weekday letters, or THE WEEK ROW
//
// The week row is the point. It is the same seven columns as one row of the
// month grid, in the same geometry (`grid-cols-7 px-2`), so when you lean into
// a day the row you were looking at is still on screen in the same place — the
// eye keeps something to hold while the body zooms. Nothing here unmounts on a
// horizon change, which is what makes it a persistent object rather than a
// header that happens to look similar.
//
// `LensZoom` is the motion for the OTHER axis. `TimePager` owns travel (same
// horizon, next date); this owns zoom (same date, next horizon), and the two
// never overlap: travel is a finger-following horizontal page, zoom is a
// scale-and-dissolve anchored on the column of the day you are standing on.
// Reduced motion skips it.

import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { Icon, type IconName } from "../Icon";
import TimeZoneChip from "../TimeZoneChip";
import WeatherIcon from "../WeatherIcon";
import type { indexWeather } from "../../hooks/useWeather";
import { buildDayPlan, dayKey, loadDots, type DayCtx, type DayPlan } from "./dayPlan";
import { prefersReducedMotion } from "./TimePager";

/** The five faces of the mobile Calendar. `schedule` is the agenda (List). */
export type CalHorizon = "schedule" | "day" | "week" | "month" | "year";

/**
 * The hour-label column, shared by the Day canvas, the Week canvas AND the
 * week row's left inset.
 *
 * It has to be ONE number. The two canvases used to gutter differently (56 and
 * 34), so a week row aligned to either would have jumped sideways the moment
 * you moved between the two rungs — and the week row's whole job is to be the
 * thing that does not move. Sharing it also means the row's seven cells sit
 * exactly over the seven columns of the week grid they head, which is what
 * makes them readable as day headers rather than a decoration above a grid.
 */
export const CAL_GUTTER = 38;

/** One spelling of an hour, everywhere a time axis is labelled: `9am`, `12pm`.
 *  The Day lens printed `9 AM` and the Week lens `9am`; the compact form is the
 *  one that fits a 38px gutter, so it is the one both wear. */
export const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" }).replace(" ", "").toLowerCase();

// ── The ladder ──────────────────────────────────────────────────────────────
// Four rungs, tight to wide, plus the agenda. Single letters because five words
// do not fit a 375px row beside a hero — and because the hero right next to the
// lit face always spells it out ("August 2026" while M is lit), so the letter
// never has to be read cold. The word itself lives in the accessible name.
const FACES: { id: CalHorizon; label: string; glyph?: IconName; word: string }[] = [
  { id: "schedule", label: "", glyph: "agenda", word: "Agenda — the next two weeks" },
  { id: "day", label: "D", word: "Day" },
  { id: "week", label: "W", word: "Week" },
  { id: "month", label: "M", word: "Month" },
  { id: "year", label: "Y", word: "Year" },
];

/** How wide a span each face covers — the zoom axis, in rungs. */
const RANK: Record<CalHorizon, number> = { day: 0, week: 1, schedule: 1, month: 2, year: 3 };

export type ZoomDir = "in" | "out" | "lateral";

/** Which way the zoom goes. Equal rungs (Week ↔ Agenda are both a fortnight's
 *  worth of one question) cross-dissolve instead of scaling — a scale would
 *  claim an altitude change that didn't happen. */
export function zoomDir(from: CalHorizon, to: CalHorizon): ZoomDir | null {
  if (from === to) return null;
  const d = RANK[to] - RANK[from];
  return d === 0 ? "lateral" : d < 0 ? "in" : "out";
}

function HorizonLadder({
  horizon,
  onHorizon,
}: {
  horizon: CalHorizon;
  onHorizon: (h: CalHorizon) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time horizon"
      className="flex shrink-0 items-center rounded-full bg-surface-2 p-0.5"
    >
      {FACES.map((f, i) => {
        const on = horizon === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => !on && onHorizon(f.id)}
            aria-pressed={on}
            aria-label={f.word}
            title={f.word}
            // `tap-icon` grows the hit area to 44×44 from the centre without
            // growing the drawn face — five 36px faces still fit beside a hero
            // at 375px, and every one of them is a thumb target.
            className={`tap-icon fast flex h-8 min-w-[34px] items-center justify-center rounded-full text-label font-semibold ${
              on ? "bg-surface text-accent" : "text-muted"
            } ${
              // A hairline after the agenda: it is a projection, not a rung.
              i === 0 ? "mr-0.5 border-r border-line pr-1" : ""
            }`}
            style={on ? { boxShadow: "var(--shadow-1)" } : undefined}
          >
            {f.glyph ? <Icon name={f.glyph} size={14} /> : f.label}
          </button>
        );
      })}
    </div>
  );
}

// ── The header ──────────────────────────────────────────────────────────────

export interface CalendarHeaderProps {
  /** The span you're looking at, in Fraunces — "Today", "Aug 24 – 30", "2026". */
  hero: string;
  /** The one fact about it, in mono beside the hero — the day's free/busy read. */
  heroFact?: string;
  /** True when that fact is the accent-worthy one (open time, not a count). */
  heroFactAccent?: boolean;
  /** Tapping the hero opens the OS date picker — the "jump anywhere" path the
   *  agenda's calendar glyph used to be. Omitted where a date makes no sense. */
  jumpDate?: Date;
  onJump?: (d: Date) => void;
  horizon: CalHorizon;
  onHorizon: (h: CalHorizon) => void;
  /** What ‹ › move, in words, for the accessible name: "day" / "week" / … */
  travelUnit: string;
  onPrev: () => void;
  onNext: () => void;
  /** Present only while you're off the current span — never a dead control. */
  onToday?: () => void;
  onUpkeep?: () => void;
  onNew?: () => void;
  now: Date;
}

export function CalendarHeader({
  hero,
  heroFact,
  heroFactAccent,
  jumpDate,
  onJump,
  horizon,
  onHorizon,
  travelUnit,
  onPrev,
  onNext,
  onToday,
  onUpkeep,
  onNew,
  now,
}: CalendarHeaderProps) {
  const jumpRef = useRef<HTMLInputElement>(null);
  const canJump = !!(jumpDate && onJump);

  const heroInner = (
    <>
      <h2 className="text-lead masthead min-w-0 truncate text-ink">{hero}</h2>
      {heroFact && (
        <span
          className="mono shrink-0 text-label"
          style={{ color: heroFactAccent ? "var(--accent)" : "var(--muted)" }}
        >
          {heroFact}
        </span>
      )}
    </>
  );

  return (
    <>
      {/* Row A — the subject. */}
      <div className="flex items-center gap-2 px-3 pt-2">
        {canJump ? (
          <button
            type="button"
            onClick={() => {
              const el = jumpRef.current;
              if (!el) return;
              // `showPicker` where it exists (iOS 16+, every engine we ship on);
              // focus is the honest fallback rather than a dead hero.
              try {
                el.showPicker();
              } catch {
                el.focus();
              }
            }}
            aria-label={`${hero} — jump to another date`}
            className="tap-h fast -ml-1 flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-1 text-left active:bg-surface-2"
          >
            {heroInner}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline gap-2">{heroInner}</div>
        )}
        {canJump && (
          // `sr-only` and opened by the button above: iOS paints a date input's
          // own value at the control's intrinsic width while its picker is
          // open, which used to smear "Aug 17," across the header.
          <input
            ref={jumpRef}
            type="date"
            value={jumpDate!.toLocaleDateString("en-CA")}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split("-").map(Number);
              if (y && m && d) onJump!(new Date(y, m - 1, d));
            }}
            aria-label="Jump to date"
            className="sr-only"
            tabIndex={-1}
          />
        )}
        {/* The clock these times are in — a glyph only while you're away from
            home (see TimeZoneChip). It used to sit on four of the five lenses
            saying nothing at all. */}
        <TimeZoneChip now={now} hideAtHome />
        {onUpkeep && (
          <button
            type="button"
            onClick={onUpkeep}
            aria-label="Recurring upkeep"
            title="Recurring upkeep"
            className="tap-icon fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2"
          >
            <Icon name="repeat" size={15} />
          </button>
        )}
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            aria-label="New event"
            className="tap-icon fast flex h-8 w-8 items-center justify-center rounded-full text-accent active:bg-surface-2"
          >
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>

      {/* Row B — where you are on the ladder, and travel at that rung. One
          direction grammar with the swipe: ‹ is earlier, › is later. */}
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-1">
        <HorizonLadder horizon={horizon} onHorizon={onHorizon} />
        <div className="flex-1" />
        {onToday && (
          <button
            type="button"
            onClick={onToday}
            className="tap-h fast mr-0.5 rounded-full border border-line px-2.5 py-1 text-label font-medium text-muted active:bg-surface-2"
          >
            Today
          </button>
        )}
        <button
          type="button"
          onClick={onPrev}
          aria-label={`Previous ${travelUnit}`}
          className="tap-icon fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2"
        >
          <Icon name="chevron-left" size={15} />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label={`Next ${travelUnit}`}
          className="tap-icon fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2"
        >
          <Icon name="chevron-right" size={15} />
        </button>
      </div>
    </>
  );
}

// ── The seven columns ───────────────────────────────────────────────────────
/**
 * ONE seven-column geometry, for every band and every grid on this surface: the
 * hour gutter, then seven equal columns, then the right margin. The month's
 * letters, the week row, and the month grid itself all wear it.
 *
 * It has to be one, because a Friday that sits at a different x on the month
 * than it does on the week is the jump the zoom was supposed to remove — the
 * band would slide 38px sideways while the body scaled, and a fixed point that
 * moves is not a fixed point. So the month grid pays the gutter it has no time
 * axis for, and gets something real back for it: see `MonthSheet`'s week door.
 */
export const COLS = "grid grid-cols-7 pr-2";
export const COLS_INSET = { paddingLeft: CAL_GUTTER } as const;

/** The month's column letters. Hoisted out of the paging month body: the
 *  letters are the same in every month, so paging them was motion that carried
 *  no information — and out here they hold still under the zoom. Leaning in
 *  from the month, these letters don't move at all; the numerals and dots grow
 *  underneath them into the week row below. */
export function WeekdayLetters({ weekStartsOn }: { weekStartsOn: 0 | 1 }) {
  const start = startOfWeek(new Date(2024, 0, 7), { weekStartsOn });
  return (
    <div className={COLS} style={COLS_INSET} aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="py-1 text-center text-micro font-medium uppercase text-muted">
          {addDays(start, i).toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
        </div>
      ))}
    </div>
  );
}

/** One day, drawn as a cell — the numeral, its load dots, and the forecast in
 *  the corner. Shared by the month grid and the week row so a Tuesday is the
 *  SAME PICTURE at both horizons; that sameness is what carries the zoom.
 *  Focus lifts (`glass-lift`) rather than outlining, per the design language. */
export const DayCell = memo(function DayCell({
  day,
  selected,
  dim = false,
  square = false,
  showWeekday = false,
  focal = false,
  wx,
  onPick,
}: {
  day: DayPlan;
  selected: boolean;
  /** Outside the month being shown — a spill-over cell. */
  dim?: boolean;
  /** The month grid's cells are square; the week row's are a fixed strip. */
  square?: boolean;
  showWeekday?: boolean;
  /** Marks the cell the zoom is anchored on (the month's selected day). */
  focal?: boolean;
  wx?: { wmo: number };
  onPick: (d: Date) => void;
}) {
  const { date, isToday, openMins, isPast } = day;
  const dots = loadDots(day);
  const busy = dots.length;

  return (
    <button
      type="button"
      onClick={() => onPick(date)}
      data-focal={focal ? "" : undefined}
      aria-label={`${format(date, "EEEE, MMMM d")} — ${
        busy === 0
          ? "free"
          : `${busy} commitment${busy === 1 ? "" : "s"}${
              !isPast && openMins > 0 ? `, ${Math.round(openMins / 60)}h free` : ""
            }`
      }`}
      aria-current={isToday ? "date" : undefined}
      aria-pressed={selected}
      className={`tap fast relative flex flex-col items-center justify-start gap-0.5 rounded-xl py-1.5 ${
        square ? "aspect-square" : ""
      } ${selected ? "glass-lift" : "active:bg-surface-2"}`}
    >
      {showWeekday && (
        <span
          className={`text-micro font-medium uppercase leading-none ${
            isToday ? "text-accent" : "text-muted"
          }`}
        >
          {date.toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
        </span>
      )}
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-body leading-none ${
          isToday
            ? "bg-accent font-semibold text-on-accent"
            : selected
              ? "font-semibold text-ink"
              : ""
        } ${dim ? "text-muted/50" : isToday ? "" : "text-ink"}`}
      >
        {date.getDate()}
      </span>
      {/* Weather rides the corner; the load dots keep the slot under the
          numeral. Load is the planner's data and weather is the garnish, so
          load is the one that never gives up its place. */}
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
});

/** The week the selected day sits in — the persistent object. It is one row of
 *  the month grid, in the month grid's geometry, and it is what stays put when
 *  you lean in from the month or stand back from a day. */
export function WeekRow({
  weekStart,
  selected,
  ctx,
  weatherIndex,
  onPick,
}: {
  weekStart: Date;
  selected: Date;
  ctx: DayCtx;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  onPick: (d: Date) => void;
}) {
  const selKey = dayKey(selected);
  return (
    <div className={COLS} style={COLS_INSET}>
      {Array.from({ length: 7 }, (_, i) => {
        const plan = buildDayPlan(addDays(weekStart, i), ctx);
        return (
          <DayCell
            key={dayKey(plan.date)}
            day={plan}
            selected={dayKey(plan.date) === selKey}
            dim={plan.isBygone}
            showWeekday
            wx={weatherIndex?.get(plan.date.toLocaleDateString("en-CA"))}
            onPick={onPick}
          />
        );
      })}
    </div>
  );
}

// ── The zoom ────────────────────────────────────────────────────────────────

type ZoomState = { t: "idle" } | { t: "zoom"; leaving: ReactNode; dir: ZoomDir; origin: string };

/** Where each layer starts and ends. Leaning in, the horizon you left rushes
 *  PAST you (out through the glass) and the new one rises from under it;
 *  standing back, the reverse. Equal rungs only cross-fade — a scale would
 *  claim an altitude change that didn't happen. */
const SCALE = {
  in: { leave: 1.14, enter: 0.9 },
  out: { leave: 0.9, enter: 1.14 },
  lateral: { leave: 1, enter: 1 },
} as const;

/** Read a motion token so the zoom obeys the same clock as everything else.
 *  Cheap, and only on a horizon change. */
function motion(): { ms: number; easing: string } {
  const cs = typeof window === "undefined" ? null : getComputedStyle(document.documentElement);
  const raw = cs?.getPropertyValue("--d-base").trim() || "220ms";
  const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : 220;
  return {
    ms: Number.isFinite(ms) && ms > 0 ? ms : 220,
    easing: cs?.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.22, 1, 0.36, 1)",
  };
}

/**
 * The fade is LINEAR while the scale is eased, and they are separate animations
 * for that reason alone.
 *
 * `--ease-out` is a quint — 85% of the way there in a third of the duration.
 * That is right for something arriving, and wrong for a cross-dissolve: run the
 * two opacities on it and the horizon you left is at 15% before the eye has
 * found it, which is the hard swap again wearing 220ms. Linear keeps the two
 * layers summing to one, so what you see is genuinely one horizon becoming the
 * other rather than a flicker between them.
 */
const FADE = "linear";

/**
 * The zoom axis, given motion.
 *
 * Standing back and leaning in used to be a hard swap — the one act that
 * changes the most on screen was the only one with no transition at all, which
 * is most of why it read as "losing your place". Both layers now move the same
 * way through the same origin: leaning in, the outgoing horizon rushes past you
 * while the new one rises from under it; standing back, the reverse.
 *
 * The origin is the COLUMN of the day you are standing on, so the motion
 * emanates from the same seven columns the week row occupies in the chrome
 * above — the persistent object and the moving one agree about where "your
 * day" is. Reduced motion gets the swap, with no travel and no fade.
 */
export function LensZoom({
  zoomKey,
  dir,
  origin,
  children,
}: {
  /** Changes exactly when the horizon does. */
  zoomKey: string;
  /** Which way this change went; `null` never animates. */
  dir: ZoomDir | null;
  /** CSS `transform-origin` — the selected day's column. */
  origin: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<ZoomState>({ t: "idle" });
  const keyRef = useRef(zoomKey);
  const settledRef = useRef(children);
  const dirRef = useRef(dir);
  const originRef = useRef(origin);
  dirRef.current = dir;
  originRef.current = origin;
  const asideRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const reduce = prefersReducedMotion();

  // Keep the last settled body, so there is something to send away.
  useEffect(() => {
    if (mode.t === "idle") settledRef.current = children;
  }, [children, mode.t]);

  useLayoutEffect(() => {
    if (keyRef.current === zoomKey) return;
    keyRef.current = zoomKey;
    const d = dirRef.current;
    if (!d || reduce) {
      setMode({ t: "idle" });
      return;
    }
    setMode({ t: "zoom", leaving: settledRef.current, dir: d, origin: originRef.current });
  }, [zoomKey, reduce]);

  // Driven by `Element.animate` rather than a CSS transition, for two reasons a
  // transition can't answer. The outgoing layer is a BRAND NEW element every
  // zoom, and a transition on a just-inserted node needs a painted starting
  // frame — which React never gives it, so the layer sat frozen at scale 1
  // while the arriving one moved: a cross-fade with only one half. And zooming
  // twice the same way in a row (month → week → day) would not restart a CSS
  // animation, because nothing about the class changed. `animate()` has neither
  // problem: it always starts, on any element, from the values given here.
  useLayoutEffect(() => {
    if (mode.t !== "zoom") return;
    const s = SCALE[mode.dir];
    const { ms, easing } = motion();
    const running: Animation[] = [];
    const layer = (el: HTMLElement | null, from: number, to: number, fadeTo: 0 | 1) => {
      if (!el) return;
      running.push(
        el.animate([{ transform: `scale(${from})` }, { transform: `scale(${to})` }], {
          duration: ms,
          easing,
          fill: "both",
        }),
      );
      running.push(
        el.animate([{ opacity: 1 - fadeTo }, { opacity: fadeTo }], {
          duration: ms,
          easing: FADE,
          fill: "both",
        }),
      );
    };
    layer(asideRef.current, 1, s.leave, 0);
    layer(mainRef.current, s.enter, 1, 1);
    // Belt and braces: `onfinish` never arriving (a backgrounded tab, a
    // mid-flight remount) must not leave the outgoing horizon on screen.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setMode({ t: "idle" });
    };
    for (const a of running) a.onfinish = settle;
    const t = window.setTimeout(settle, ms + 200);
    return () => {
      window.clearTimeout(t);
      for (const a of running) a.cancel();
    };
  }, [mode]);

  const zooming = mode.t === "zoom";

  return (
    <div className={`lens-zoom ${zooming ? "is-zooming" : ""}`}>
      {zooming && (
        <div
          ref={asideRef}
          className="lens-zoom-layer is-aside"
          aria-hidden
          style={{ transformOrigin: mode.origin }}
        >
          {mode.leaving}
        </div>
      )}
      <div
        ref={mainRef}
        className="lens-zoom-layer"
        style={zooming ? { transformOrigin: mode.origin } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
