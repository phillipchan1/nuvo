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
import type { CalendarTap } from "./MobileEventSheet";
import { at, buildDayPlan, dayKey, dayReadout, type DayCtx, type DayPlan } from "./dayPlan";
import { CAL_GUTTER, COLS, DayCell } from "./CalendarChrome";
import TimePager from "./TimePager";

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
}) {
  const sheet = (month: Date) => (
    <MonthSheet
      monthCursor={month}
      ctx={ctx}
      selected={selected}
      weekStartsOn={weekStartsOn}
      weatherIndex={weatherIndex}
      onPick={onPick}
      onOpenWeek={onOpenWeek}
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
        peekPrev={sheet(addMonths(monthCursor, -1))}
        peekNext={sheet(addMonths(monthCursor, 1))}
      >
        {sheet(monthCursor)}
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
  onPick: (d: Date) => void;
  onOpenWeek: (weekStart: Date) => void;
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
          <div key={dayKey(week[0].date)} className="flex items-stretch pr-2">
            {/* The gutter. A month has no time axis, but the geometry is shared
                with the two canvases that do (see `COLS`), so this column
                exists — and rather than 38px of blank paper it is the door to
                that week: leaning into a specific week used to cost selecting
                one of its days and then tapping W. The chevron marks the row
                the band above is currently showing. */}
            <button
              type="button"
              onClick={() => onOpenWeek(week[0].date)}
              aria-label={`Open the week of ${format(week[0].date, "MMMM d")}`}
              className="tap fast flex shrink-0 items-center justify-center rounded-l-xl active:bg-surface-2"
              style={{ width: CAL_GUTTER }}
            >
              <Icon
                name="chevron-right"
                size={12}
                className={holdsSelected ? "text-accent" : "text-muted opacity-40"}
              />
            </button>
            <div className={`${COLS} flex-1 !pr-0`}>
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
                    onPick={onPick}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

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
}: {
  day: DayPlan;
  onOpen: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
}) {
  // A drag that starts on a row is a scroll. Without this, WebKit still fires
  // click on the button the finger began on, and you fall into the event
  // instead of seeing the rest of the list.
  const dragged = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const { date, timed, allDay, anytime, openMins, isPast, isBygone } = day;
  const busy = timed.length + allDay.length + anytime.length;
  const { text: readout, accent } = dayReadout(day);
  const rest = Math.max(0, busy - PREVIEW_CAP);
  const shownAllDay = allDay.slice(0, PREVIEW_CAP);
  const afterAllDay = PREVIEW_CAP - shownAllDay.length;
  const shownAnytime = anytime.slice(0, afterAllDay);
  const shownTimed = timed.slice(0, afterAllDay - shownAnytime.length);

  return (
    <div
      className="mt-2 border-t border-line"
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
                : isSlot
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
            <button onClick={onOpen} className="tap fast py-1.5 text-left text-label text-muted active:opacity-70">
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
