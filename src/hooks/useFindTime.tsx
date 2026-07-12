// useFindTime — assembles the live week boundaries once, then exposes two
// actions: findTime(task) (compute a slot) and place(task, placement) (write
// it). The boundary assembly is deliberately identical to the Sunday ritual's
// (SundayRitual.tsx) so a midweek single-task fit behaves exactly like the
// weekly compose — same hidden-calendar rules, same budget, same contexts.
//
// SPIKE: currently only consumed by the dev-flagged "Find time this week"
// action in MobileTaskSheet. Kept as a reusable hook so the desktop task
// popover can adopt it without change.

import { useMemo } from "react";
import { addDays } from "date-fns";
import { useVertical } from "./useVertical";
import { useSettings } from "./useSettings";
import { useWorkingDays } from "./useWorkingDays";
import { useExternalEvents } from "./useCalendar";
import { useScheduledTasks } from "./useTasks";
import { parseDateISO, planningWeekStartISO, todayISO } from "../lib/dates";
import { calibrate, weeklyBudgetMins } from "../lib/calibration";
import { isEventHidden } from "../lib/now";
import { findTimeFor, type FindTimeContext, type FindTimeResult } from "../lib/findTime";
import type { DayContext, Placement } from "../lib/compose";
import type { Task } from "../lib/types";

export function useFindTime() {
  const { data, applySchedule } = useVertical();
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();

  const weekStartISO = planningWeekStartISO();
  const today = todayISO();
  const range = useMemo(() => {
    const start = parseDateISO(weekStartISO);
    return { start: start.toISOString(), end: addDays(start, 7).toISOString() };
  }, [weekStartISO]);

  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: blocks = [] } = useScheduledTasks(range.start, range.end);

  // honor hidden calendars/events exactly like the Sunday flow — a hidden
  // calendar is not "busy", so it never makes the week look fuller than it is.
  const hiddenCals = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const hiddenEventKeys = useMemo(
    () => new Set((settings?.hidden_events ?? []).map((h) => h.key)),
    [settings],
  );
  const visibleEvents = useMemo(
    () => events.filter((e) => !hiddenCals.has(e.calendar_id) && !isEventHidden(e, hiddenEventKeys)),
    [events, hiddenCals, hiddenEventKeys],
  );

  const onCalBlocks = useMemo(() => blocks.filter((b) => b.status !== "done"), [blocks]);
  const blockedMins = useMemo(
    () => onCalBlocks.reduce((s, b) => s + (b.duration_minutes ?? 30), 0),
    [onCalBlocks],
  );

  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;
  const dayContexts = useMemo(
    () => (data.sprint?.day_contexts ?? {}) as Record<string, DayContext>,
    [data.sprint],
  );

  const cal = useMemo(() => calibrate(data.tasks), [data.tasks]);
  const budget = weeklyBudgetMins(cal);

  const ctx: FindTimeContext = useMemo(
    () => ({
      weekStartISO,
      todayISO: today,
      events: visibleEvents,
      blocks: onCalBlocks,
      workStartMin: workStart,
      workEndMin: workEnd,
      focusInitiativeIds: data.focusInitiativeIds,
      dayContexts,
      workingDays,
      // the same "protect the proven pace" guard the ritual applies, minus what's
      // already blocked on the calendar this week
      weeklyBudgetMins: budget != null ? Math.max(0, budget - blockedMins) : null,
    }),
    [weekStartISO, today, visibleEvents, onCalBlocks, workStart, workEnd, data.focusInitiativeIds, dayContexts, workingDays, budget, blockedMins],
  );

  const findTime = (task: Task): FindTimeResult => findTimeFor(task, ctx);

  /** Write the found slot: schedule the task directly (the task IS the block)
   *  and stamp the sprint so a loose inbox capture joins the committed week and
   *  leaves the inbox — mirrors applySchedule's use in the Sunday flow. */
  const place = async (task: Task, placement: Placement) => {
    const [y, mo, d] = placement.dayISO.split("-").map(Number);
    const startISO = new Date(
      y,
      mo - 1,
      d,
      Math.floor(placement.startMin / 60),
      placement.startMin % 60,
    ).toISOString();
    await applySchedule(
      [{ id: task.id, doDateISO: placement.dayISO, startISO, durationMins: placement.durationMin }],
      { sprintId: data.sprint?.id ?? null },
    );
  };

  return { findTime, place };
}
