// The Month body — the whole month at a glance: each day carries free/busy
// density dots so you can scan for open days, and the day you tapped spells
// itself out underneath (D-119: the month answers the month, and the day you
// tapped; the week's slate is a strip in the chrome, not a second grid here).
//
// Body only. The month's name, the horizon ladder, travel and the weekday
// letters live in `CalendarChrome`, mounted once by `CalendarSurface` — the
// letters especially, because they are the same in every month, so paging them
// was motion carrying no information.
//
// A day cell is the same drawing as a cell of the week row (`DayCell`), which
// is what lets the zoom read as one row of this grid coming forward.

import { useMemo, useRef } from "react";
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { fmtMins } from "../../lib/now";
import type { indexWeather } from "../../hooks/useWeather";
import WeatherIcon from "../WeatherIcon";
import { Icon } from "../Icon";
import { Button } from "../kit";
import type { CalendarTap } from "./MobileEventSheet";
import { buildDayPlan, dayKey, dayReadout, type DayCtx, type DayPlan } from "./dayPlan";
import { ColumnBand, DayCell } from "./CalendarChrome";
import { PlanRow, TimedRow, allDayTap, type ToggleTask } from "./planRows";
import { clampDayToMonth } from "./monthTap";
import TimePager from "./TimePager";

const noop = () => {};

export default function MobileMonthView({
  monthCursor,
  ctx,
  selected,
  weekStartsOn,
  weatherIndex,
  onPrev,
  onNext,
  onPick,
  onOpenDay,
  onOpenWeek,
  onFlickUp,
  onTapEvent,
  onTapTask,
  onToggleTask,
}: {
  monthCursor: Date;
  ctx: DayCtx;
  selected: Date;
  weekStartsOn: 0 | 1;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  onPrev: () => void;
  onNext: () => void;
  /** A cell tap — reads the day (first tap) or leans in (on the selected one). */
  onPick: (d: Date) => void;
  /** Lean in on a day, from the preview's own header. */
  onOpenDay: (d: Date) => void;
  /** Lean in on a whole row — the door in the grid's left gutter. */
  onOpenWeek: (weekStart: Date) => void;
  onFlickUp: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
  onToggleTask?: ToggleTask;
}) {
  // The peeking months are inert: a cell that is half off-screen under a moving
  // finger is a mis-tap, not a choice. They also carry the selection *clamped*
  // into their own month, so the row the band is showing reads plausibly while
  // it slides rather than losing its mark (D-121).
  const sheet = (month: Date, interactive: boolean) => (
    <MonthSheet
      monthCursor={month}
      ctx={ctx}
      selected={interactive ? selected : clampDayToMonth(selected, month)}
      weekStartsOn={weekStartsOn}
      weatherIndex={weatherIndex}
      onPick={interactive ? onPick : undefined}
      onOpenWeek={interactive ? onOpenWeek : undefined}
    />
  );

  return (
    <div>
      {/* The month itself travels — swipe left is later, swipe right is
          earlier. Adjacent months peek under the finger so the gesture is the
          animation. An upward flick expands into the last drill-in lens. */}
      <TimePager
        pageKey={format(monthCursor, "yyyy-MM")}
        onPrev={onPrev}
        onNext={onNext}
        onFlickUp={onFlickUp}
        peekPrev={sheet(addMonths(monthCursor, -1), false)}
        peekNext={sheet(addMonths(monthCursor, 1), false)}
      >
        {sheet(monthCursor, true)}
      </TimePager>

      {/* Outside the pager on purpose: this is a list you scroll, not a page
          you swipe. Inside TimePager a drag on a row was claimed as a tap and
          opened the event. */}
      {isSameMonth(selected, monthCursor) && (
        <MonthDayPreview
          day={buildDayPlan(selected, ctx)}
          onOpen={() => onOpenDay(selected)}
          onTapEvent={onTapEvent}
          onTapTask={onTapTask}
          onToggleTask={onToggleTask}
        />
      )}
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
  onOpenWeek,
}: {
  monthCursor: Date;
  ctx: DayCtx;
  selected: Date;
  weekStartsOn: 0 | 1;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  /** Omitted on a peeking month — see `sheet()`. */
  onPick?: (d: Date) => void;
  onOpenWeek?: (weekStart: Date) => void;
}) {
  // Cut into weeks, because a week is a row you can act on — see the door in
  // the gutter below.
  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthCursor), { weekStartsOn });
    const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn });
    const out: DayPlan[][] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 7)) {
      out.push(Array.from({ length: 7 }, (_, i) => buildDayPlan(addDays(d, i), ctx)));
    }
    return out;
  }, [monthCursor, ctx, weekStartsOn]);

  return (
    <div>
      {weeks.map((week) => {
        const holdsSelected = week.some((d) => isSameDay(d.date, selected));
        return (
          <ColumnBand
            key={dayKey(week[0].date)}
            // The gutter. A month has no time axis, but the geometry is shared
            // with the two canvases that do (see `ColumnBand`), so this column
            // exists — and rather than 38px of blank paper it is the door to
            // that week: leaning into a specific week used to cost selecting
            // one of its days and then tapping W. The chevron marks the row
            // the band above is currently showing.
            gutter={
              <button
                type="button"
                onClick={() => onOpenWeek?.(week[0].date)}
                disabled={!onOpenWeek}
                aria-label={`Open the week of ${format(week[0].date, "MMMM d")}`}
                className="tap fast flex h-full w-full items-center justify-center rounded-[var(--r-card)]"
              >
                <Icon
                  name="chevron-right"
                  size={14}
                  style={{ color: holdsSelected ? "var(--ink-2)" : "var(--faint)", opacity: holdsSelected ? 1 : 0.6 }}
                />
              </button>
            }
          >
            {week.map((d) => {
              const isSel = isSameDay(d.date, selected);
              return (
                <DayCell
                  key={dayKey(d.date)}
                  day={d}
                  selected={isSel}
                  dim={!isSameMonth(d.date, monthCursor)}
                  square
                  // The cell the zoom is anchored on, so leaning in emanates
                  // from the day you tapped rather than from the middle.
                  focal={isSel}
                  wx={weatherIndex?.get(d.date.toLocaleDateString("en-CA"))}
                  onPick={onPick ?? noop}
                />
              );
            })}
          </ColumnBand>
        );
      })}

      {/* What the marks mean — colour alone is not a legend, and a legend that
          names only some of what's on screen is worse than none: it reads as a
          complete key. So the weather row appears exactly when weather does. */}
      <div aria-hidden className="ph-legend">
        <span>
          <span className="ph-legend-dot" style={{ background: "var(--accent)" }} />
          Tasks
        </span>
        <span>
          <span className="ph-legend-dot" style={{ background: "var(--line-2)" }} />
          Events
        </span>
        {weatherIndex && weatherIndex.size > 0 && (
          <span>
            <WeatherIcon wmo={2} size={11} className="opacity-80" />
            Forecast
          </span>
        )}
      </div>
    </div>
  );
}

// The selected day's plan under the month grid — the space the week's slate
// used to occupy, answering a day's question instead of a week's. The header
// leans in; a row opens that commitment. Caps the list so a packed day doesn't
// push the FAB off the paper.
const PREVIEW_CAP = 6;

function MonthDayPreview({
  day,
  onOpen,
  onTapEvent,
  onTapTask,
  onToggleTask,
}: {
  day: DayPlan;
  onOpen: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
  onToggleTask?: ToggleTask;
}) {
  // A drag that starts on a row is a scroll. Without this, WebKit still fires
  // click on the button the finger began on, and you fall into the event
  // instead of seeing the rest of the list.
  const dragged = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const { date, timed, allDay, anytime, openMins, isPast, isBygone, isToday } = day;
  const busy = timed.length + allDay.length + anytime.length;
  const { text: readout, accent } = dayReadout(day);
  const rest = Math.max(0, busy - PREVIEW_CAP);
  const shownAllDay = allDay.slice(0, PREVIEW_CAP);
  const afterAllDay = PREVIEW_CAP - shownAllDay.length;
  const shownAnytime = anytime.slice(0, afterAllDay);
  const shownTimed = timed.slice(0, afterAllDay - shownAnytime.length);

  return (
    <div
      className="mt-2"
      data-time-pager-ignore
      onPointerDown={(e) => {
        dragged.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (Math.abs(e.clientX - origin.current.x) > 8 || Math.abs(e.clientY - origin.current.y) > 8) {
          dragged.current = true;
        }
      }}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        e.preventDefault();
        e.stopPropagation();
        dragged.current = false;
      }}
    >
      {/* The header leans in on the day — a second way to the Day lens. */}
      <button type="button" onClick={onOpen} className="ph-dayhead row-hover" style={{ borderTop: "1px solid var(--line-1)" }}>
        <span className="ph-dayhead-label" data-today={isToday || undefined} data-past={isBygone || undefined}>
          {date.toLocaleDateString([], { weekday: "long" })}
        </span>
        <span className="ph-dayhead-date">{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
        {readout && (
          <span className="ph-dayhead-read" data-accent={accent || undefined}>
            {readout}
          </span>
        )}
        <Icon name="chevron-right" size={16} className={readout ? "shrink-0 self-center" : "ml-auto shrink-0 self-center"} style={{ color: "var(--faint)" }} />
      </button>

      {busy === 0 ? (
        <div className="ph-dayempty">{isBygone ? "Nothing scheduled" : isPast ? "Done for today" : "Wide open"}</div>
      ) : (
        <>
          {shownAllDay.map((e) => (
            <PlanRow
              key={e.id}
              time="all day"
              mark={{ kind: "bar", color: "var(--event-default)" }}
              title={e.title || "Busy"}
              onOpen={() => onTapEvent?.(allDayTap(e))}
            />
          ))}
          {shownAnytime.map((t) => (
            <PlanRow
              key={t.id}
              time="anytime"
              mark={{
                kind: "check",
                checked: false,
                label: `Complete ${t.title}`,
                onToggle: onToggleTask ? (next) => onToggleTask(t.id, next) : undefined,
              }}
              title={t.title}
              onOpen={() => onTapTask?.(t.id)}
            />
          ))}
          {shownTimed.map((b, i) => (
            <TimedRow key={i} item={b} onTapEvent={onTapEvent} onToggleTask={onToggleTask} />
          ))}
          {(rest > 0 || (!isPast && !isBygone && openMins > 0)) && (
            <div className="flex items-center gap-2 px-4 pt-1">
              {rest > 0 && (
                <Button kind="ghost" size="md" className="tap-h -ml-3" onClick={onOpen}>
                  {rest} more
                </Button>
              )}
              {!isPast && !isBygone && openMins > 0 && (
                <span className="ml-auto text-caption tabular-nums text-muted">{fmtMins(openMins)} still open</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
