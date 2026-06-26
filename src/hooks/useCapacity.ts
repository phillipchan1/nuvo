// useCapacity — the realistic capacity read behind the Commitment meter. It learns
// your true weekly meeting load from the *trailing* weeks (which are fully booked in
// hindsight, unlike the optimistic future), reserves a buffer, and counts only usable
// focus gaps. Returns both the typical-week picture and a per-week forecast where far
// weeks inherit the trailing-typical meeting load. See src/lib/capacity.ts.

import { useMemo } from "react";
import { addDays, startOfWeek } from "date-fns";
import { useExternalEvents } from "./useCalendar";
import { useScheduledTasks } from "./useTasks";
import { useSettings } from "./useSettings";
import { toBusyBlocks } from "../lib/now";
import { BUFFER_FRAC, weekLoad } from "../lib/capacity";

const FORWARD_WEEKS = 13;
const TRAILING_WEEKS = 4; // how far back to learn the typical meeting load
const FORECAST_WEEKS = 10; // ribbon length

export interface ForecastWeek {
  weekStart: Date;
  windowMins: number;
  busyMins: number; // effective: actual for the current week, max(actual, typical) ahead
  bufferMins: number;
}

export interface CapacityRead {
  /** Typical weekly work window (weekday minutes) — the whole pie. */
  windowMins: number;
  /** Trailing-actual weekly meeting/obligation load. */
  typicalBusyMins: number;
  /** Reserve held back from project work. */
  bufferMins: number;
  /** Realistic project-capable focus per typical week = usable free − buffer. */
  focusBudgetMins: number;
  /** Usable focus still open in the current (clipped) week, after a prorated buffer. */
  thisWeekFocusMins: number;
  /** Per-week forecast for the ribbon (current week clipped; far weeks carry typical load). */
  byWeek: ForecastWeek[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function useCapacity(): CapacityRead {
  const { settings } = useSettings();
  const now = useMemo(() => new Date(), []);

  const weekStartsOn = (settings?.week_start === 0 ? 0 : 1) as 0 | 1;
  const wStartMin = settings?.work_start_minutes ?? 480;
  const wEndMin = settings?.work_end_minutes ?? 990;

  const first = useMemo(() => startOfWeek(now, { weekStartsOn }), [now, weekStartsOn]);
  const startISO = addDays(first, -TRAILING_WEEKS * 7).toISOString();
  const endISO = addDays(first, FORWARD_WEEKS * 7).toISOString();

  const { data: events = [] } = useExternalEvents(startISO, endISO);
  const { data: blocks = [] } = useScheduledTasks(startISO, endISO);
  const hidden = settings?.hidden_calendar_ids ?? [];

  return useMemo(() => {
    const busy = toBusyBlocks(events, blocks, hidden);
    const windowMins = 5 * Math.max(0, wEndMin - wStartMin); // weekday work window
    const bufferMins = Math.round(BUFFER_FRAC * windowMins);

    // Learn the typical week from fully-booked trailing weeks.
    const past = Array.from({ length: TRAILING_WEEKS }, (_, i) => weekLoad(busy, addDays(first, -(i + 1) * 7), wStartMin, wEndMin));
    const typicalBusyMins = past.length ? avg(past.map((p) => p.busyMins)) : 0;
    const typicalUsableFreeMins = past.length ? avg(past.map((p) => p.usableFreeMins)) : windowMins;
    const focusBudgetMins = Math.max(0, Math.min(typicalUsableFreeMins, windowMins - typicalBusyMins) - bufferMins);

    // This week, clipped to now.
    const tw = weekLoad(busy, first, wStartMin, wEndMin, now);
    const thisWeekFocusMins = Math.max(0, tw.usableFreeMins - Math.round(BUFFER_FRAC * tw.windowMins));

    // Forecast: current week is real-and-clipped; far weeks inherit the trailing typical
    // (their calendars look empty only because one-offs aren't booked yet).
    const byWeek: ForecastWeek[] = Array.from({ length: FORECAST_WEEKS }, (_, w) => {
      const ws = addDays(first, w * 7);
      if (w === 0) {
        return { weekStart: ws, windowMins: tw.windowMins, busyMins: tw.busyMins, bufferMins: Math.round(BUFFER_FRAC * tw.windowMins) };
      }
      const wl = weekLoad(busy, ws, wStartMin, wEndMin);
      return { weekStart: ws, windowMins, busyMins: Math.max(wl.busyMins, typicalBusyMins), bufferMins };
    });

    return { windowMins, typicalBusyMins, bufferMins, focusBudgetMins, thisWeekFocusMins, byWeek };
  }, [events, blocks, hidden, now, first, wStartMin, wEndMin]);
}
