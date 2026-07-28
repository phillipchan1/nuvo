// useCapacity — calendar-derived weekly capacity for the commitment meter and
// the timeline ribbon. Pulls external events + scheduled blocks over a rolling
// horizon, folds them into busy blocks (the one "what counts as busy" rule), and
// hands back open work-hours per week. See src/lib/capacity.ts.

import { useMemo } from "react";
import { addDays, startOfWeek } from "date-fns";
import { useExternalEvents } from "./useCalendar";
import { useScheduledTasks } from "./useTasks";
import { useSettings, firstDayOfWeek } from "./useSettings";
import { toBusyBlocks } from "../lib/now";
import { capacityByWeek, type WeekCapacity } from "../lib/capacity";

const DEFAULT_WEEKS = 13;

/** How many upcoming full weeks define a "typical" week. Near-term so it
 *  reflects real load (recurring meetings are already booked this far out)
 *  instead of the artificially empty far future. */
const NEAR_TERM_WEEKS = 4;

export interface CapacityRead {
  /** Open work minutes left in the current (clipped) week. */
  thisWeekMins: number;
  /** Typical week capacity = the near-term average. The structural denominator,
   *  and the realistic cap for optimistic far-future weeks. */
  weeklyAvgMins: number;
  byWeek: WeekCapacity[];
}

export function useCapacity(weeks: number = DEFAULT_WEEKS): CapacityRead {
  const { settings } = useSettings();
  // Stable per mount — a fresh Date() every render would churn the query keys.
  const now = useMemo(() => new Date(), []);

  const weekStartsOn = firstDayOfWeek(settings);
  const wStartMin = settings?.work_start_minutes ?? 480;
  const wEndMin = settings?.work_end_minutes ?? 990;

  const first = useMemo(() => startOfWeek(now, { weekStartsOn }), [now, weekStartsOn]);
  const startISO = first.toISOString();
  const endISO = addDays(first, weeks * 7).toISOString();

  const { data: events = [] } = useExternalEvents(startISO, endISO);
  const { data: blocks = [] } = useScheduledTasks(startISO, endISO);
  const hidden = settings?.hidden_calendar_ids ?? [];

  return useMemo(() => {
    const busy = toBusyBlocks(events, blocks, hidden);
    const byWeek = capacityByWeek(busy, now, weeks, wStartMin, wEndMin, weekStartsOn);
    const thisWeekMins = byWeek[0]?.availMins ?? 0;
    const near = byWeek.slice(1, 1 + NEAR_TERM_WEEKS); // next few full weeks
    const weeklyAvgMins = near.length
      ? near.reduce((s, w) => s + w.availMins, 0) / near.length
      : thisWeekMins;
    return { thisWeekMins, weeklyAvgMins, byWeek };
  }, [events, blocks, hidden, now, weeks, wStartMin, wEndMin, weekStartsOn]);
}
