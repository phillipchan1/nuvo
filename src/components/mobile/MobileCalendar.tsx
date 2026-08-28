// The mobile Calendar — the data wrapper.
//
// Everything about *what the calendar looks like* moved into
// `CalendarSurface`: one chrome (horizon ladder · travel · seven columns), the
// hero it hands to the top bar, one sticky week strip, five bodies, and the two
// axes of motion
// (`TimePager` travels, `LensZoom` zooms). What is left here is the only thing
// a harness could never share — the live queries, and the window they're asked
// for.
//
// That window follows the lens, because the five horizons want wildly different
// spans and a query key that changes more than it must is a spinner the user
// paid for:
//   year      the whole year (`mobileYearRange`)
//   month     the grid, plus a month either side so a swipe peek already has
//             its dots — an empty peek that fills in after commit is the old
//             show-and-hide wearing a slide
//   day/week  one window anchored to the selected day's WEEK, so swiping a day
//             (or paging a week, or moving between the two rungs) stays on one
//             cached query
//   agenda    the loaded history behind the anchor through its 14-day horizon
//
// Everything downstream reads one `DayCtx` through `buildDayPlan` (dayPlan.ts),
// so "what counts as busy" lives in exactly one place across all five lenses.

import { useMemo, useState } from "react";
import { addDays, addMonths, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { useSettings, firstDayOfWeek } from "../../hooks/useSettings";
import { useCalendarRangePrefetch, useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks, usePlannedAnytimeTasks } from "../../hooks/useTasks";
import { useSlots, useSlotTasks } from "../../hooks/useSlots";
import { useVertical } from "../../hooks/useVertical";
import { useWeather, indexWeather } from "../../hooks/useWeather";
import { deriveSlotTitle } from "../../lib/slots";
import { isEventHidden } from "../../lib/now";
import type { Task } from "../../lib/types";
import type { RenderCrownTask } from "../../hooks/useWeekCrown";
import type { CalendarTap } from "./MobileEventSheet";
import { DAY_MS, type DayCtx } from "./dayPlan";
import type { CalHero, CalHorizon } from "./CalendarChrome";
import CalendarSurface, {
  initialCalendarWindow,
  stepCalendarWindow,
  type CalWindow,
} from "./CalendarSurface";
import { AGENDA_DAYS } from "./MobileAgendaView";
import { mobileYearRange } from "./MobileYearView";

// How far the Day / Week window reaches around the selected day's week.
const WEEK_FETCH_BEHIND = 7;
const WEEK_FETCH_AHEAD = 21;

/** The span a given standing-place needs fetched. Pure, so the same function
 *  can size the live query AND the neighbours we warm behind it. */
export function calendarRange(
  win: CalWindow,
  weekOpts: { weekStartsOn: 0 | 1 },
): { start: string; end: string } {
  const { mode, selected, monthCursor, yearCursor, pastDays } = win;
  if (mode === "year") return mobileYearRange(yearCursor);
  if (mode === "month") {
    const gridStart = startOfWeek(startOfMonth(addMonths(monthCursor, -1)), weekOpts);
    const gridEnd = addDays(endOfWeek(endOfMonth(addMonths(monthCursor, 1)), weekOpts), 1);
    return { start: gridStart.toISOString(), end: gridEnd.toISOString() };
  }
  if (mode === "day" || mode === "week") {
    const wk = startOfWeek(startOfDay(selected), weekOpts);
    return {
      start: addDays(wk, -WEEK_FETCH_BEHIND).toISOString(),
      end: addDays(wk, WEEK_FETCH_AHEAD + 1).toISOString(),
    };
  }
  // The agenda. Its own week row still needs the days either side of the
  // anchor's week, so the row's dots are never blank while the list below is
  // full — the row is the one thing that has to hold still.
  const anchor = startOfDay(selected);
  const wk = startOfWeek(anchor, weekOpts);
  const start = addDays(anchor, -pastDays);
  return {
    start: (wk < start ? wk : start).toISOString(),
    end: new Date(anchor.getTime() + (AGENDA_DAYS + 1) * DAY_MS).toISOString(),
  };
}

export default function MobileCalendar({
  now,
  onTapEvent,
  onTapTask,
  onHero,
  onOpenProject,
  renderCrownTask,
  onPlanWeek,
  initialMode,
}: {
  now: Date;
  onTapEvent?: (tap: CalendarTap) => void;
  /** Untimed (anytime) task chips — open the task sheet, not the event sheet. */
  onTapTask?: (taskId: string) => void;
  /** The span the top bar shows, handed up from the surface (D-124). */
  onHero?: (h: CalHero | null) => void;
  /** The week crown's doors — omit them and the crown stays off (harnesses,
   *  and any embed that has nowhere to route a record). */
  onOpenProject?: (id: string) => void;
  /** how the week crown renders a project's work — see `RenderCrownTask`. */
  renderCrownTask?: RenderCrownTask;
  onPlanWeek?: () => void;
  /** Harnesses pin a lens without writing `nuvo-mobile-cal-mode`. */
  initialMode?: CalHorizon;
}) {
  const { settings } = useSettings();

  // Which day a week opens on — the user's "Week starts on" setting (Settings →
  // Calendar), the same one the desktop CalendarPane reads. A *display*
  // preference only: the planning week stays Monday-based in the kernel, so a
  // Sunday-start grid never moves what week a task belongs to.
  const firstDay = firstDayOfWeek(settings);
  const weekOpts = useMemo(() => ({ weekStartsOn: firstDay }), [firstDay]);

  // Where the surface is standing. Seeded with the same helper the surface
  // seeds itself from, so the first fetch asks for the span the first render
  // will actually draw.
  const [win, setWin] = useState<CalWindow>(() => initialCalendarWindow(now, initialMode));

  const range = useMemo(() => calendarRange(win, weekOpts), [win, weekOpts]);

  // Warm the two windows a swipe can reach, so travel is a cache read instead
  // of a round trip. The lag was never the rendering: paging a month shifted
  // the query key by a month, and the *visible* month then waited on the
  // network even though two thirds of what came back was already in hand.
  // `stepCalendarWindow` is the same function the surface moves by, so what we
  // warm is exactly what the next swipe asks for — a prefetch keyed a day off
  // is worse than none, because it pays twice and still misses.
  const neighbours = useMemo(
    () => [
      calendarRange(stepCalendarWindow(win, -1), weekOpts),
      calendarRange(stepCalendarWindow(win, 1), weekOpts),
    ],
    [win, weekOpts],
  );
  useCalendarRangePrefetch(neighbours);

  const { data: events = [], isLoading: evLoading } = useExternalEvents(range.start, range.end);
  const { data: blocks = [], isLoading: blkLoading } = useScheduledTasks(range.start, range.end);
  // Standing slots — a slot is its own timed container; a task placed inside one
  // rides the slot's time instead of carrying its own start_time (see
  // assignToSlot, useTasks.ts), so it has to be fetched alongside the plain
  // scheduled blocks or it's invisible here. Same queries desktop's Planner.tsx
  // uses for CalendarPane — including anytime (planned, no clock), which used to
  // exist only on the desktop all-day row, so a ＋ capture from this tab
  // vanished the moment the sheet closed.
  const { data: slots = [], isLoading: slotLoading } = useSlots(range.start, range.end);
  const { data: anytime = [] } = usePlannedAnytimeTasks(range.start, range.end);
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);
  const { data: slotChildTasks = [] } = useSlotTasks(slotIds);
  const { data: vertical } = useVertical();

  const showWeather = settings?.show_weather ?? false;
  const { data: weatherData } = useWeather(showWeather);
  const weatherIndex = useMemo(() => indexWeather(weatherData?.days), [weatherData]);

  const hidden = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const hiddenEventKeys = useMemo(
    () => new Set((settings?.hidden_events ?? []).map((h) => h.key)),
    [settings],
  );
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
  // typed title takes its name from its project, its children's shared domain,
  // or a plain time-of-day label, so the two shells never disagree about what to
  // call the same block.
  const slotTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) m.set(s.id, deriveSlotTitle(s, slotChildren[s.id] ?? [], vertical));
    return m;
  }, [slots, slotChildren, vertical]);

  const dayCtx = useMemo<DayCtx>(() => {
    const visibleEvents = events.filter(
      (e) => !hidden.has(e.calendar_id) && !isEventHidden(e, hiddenEventKeys),
    );
    return { visibleEvents, blocks, anytime, slots, slotChildren, slotTitles, hidden, workStart, workEnd, now };
  }, [
    events,
    blocks,
    anytime,
    slots,
    slotChildren,
    slotTitles,
    hidden,
    hiddenEventKeys,
    workStart,
    workEnd,
    now,
  ]);

  return (
    <CalendarSurface
      now={now}
      ctx={dayCtx}
      loading={evLoading || blkLoading || slotLoading}
      weekStartsOn={firstDay}
      weatherIndex={showWeather ? weatherIndex : null}
      initialMode={initialMode}
      onWindowChange={setWin}
      onTapEvent={onTapEvent}
      onTapTask={onTapTask}
      onHero={onHero}
      onOpenProject={onOpenProject}
      renderCrownTask={renderCrownTask}
      onPlanWeek={onPlanWeek}
    />
  );
}
