// useWeekReport — the Week's Plan / Review data for a given week, composed
// deterministically (composeWeek). The CURRENT week is forming and fully live.
// Past weeks are SEALED and recomposed from data already persisted per-week — the
// week's own sprint row (its priorities + verdicts) and the domain pulse
// (`Domain.weeks`, 13-week invested-hours history) — so the emblem regenerates
// instantly without a separate store. (Storage of the nano prose comes later;
// the deterministic prose regenerates here.)

import { useMemo } from "react";
import { addDays, differenceInCalendarWeeks, startOfWeek } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { parseDateISO } from "../lib/dates";
import { supabase } from "../lib/supabase";
import { useVertical } from "./useVertical";
import { useExternalEvents } from "./useCalendar";
import { useScheduledTasks } from "./useTasks";
import { useSettings } from "./useSettings";
import { composeWeek, type WeekReport } from "../lib/composeWeek";
import type { BigRock, Sprint } from "../lib/types";

const WORK_START_DEFAULT = 480;
const WORK_END_DEFAULT = 990;

/** How many whole weeks `weekStartISO` is before the week containing `now`. */
export function weeksBackFrom(weekStartISO: string, now: Date): number {
  const current = startOfWeek(now, { weekStartsOn: 1 });
  const target = parseDateISO(weekStartISO);
  return differenceInCalendarWeeks(current, target, { weekStartsOn: 1 });
}

export function useWeekReport(weekStartISO: string, now: Date): WeekReport {
  const weekStart = parseDateISO(weekStartISO);
  const startISO = weekStart.toISOString();
  const endISO = addDays(weekStart, 7).toISOString();
  const back = weeksBackFrom(weekStartISO, now);
  const isPast = back > 0;

  const { data: vertical } = useVertical();
  const { settings } = useSettings();
  const { data: events = [] } = useExternalEvents(startISO, endISO);
  const { data: blocks = [] } = useScheduledTasks(startISO, endISO);

  // A past week reads its priorities from that week's own sprint row.
  const { data: pastSprint } = useQuery({
    queryKey: ["sprint", weekStartISO],
    enabled: isPast,
    queryFn: async (): Promise<Sprint | null> => {
      const { data, error } = await supabase
        .from("sprints")
        .select("*")
        .eq("week_start", weekStartISO)
        .maybeSingle();
      if (error) throw error;
      return data as Sprint | null;
    },
  });

  return useMemo(() => {
    // Past-week overrides: priorities from the week's sprint, hours from the
    // domain pulse (weeks[] is 13 entries oldest→now; index 12 = current week).
    let bigRocks: BigRock[] | undefined;
    let domainHours: Record<string, number> | undefined;
    let ambient: number | undefined;
    if (isPast) {
      bigRocks = pastSprint?.big_rocks ?? [];
      const idx = 12 - back;
      domainHours = {};
      for (const d of vertical.domains) domainHours[d.id] = idx >= 0 && idx < d.weeks.length ? d.weeks[idx] : 0;
      ambient = blocks.filter((t) => t.status === "done").length;
    }

    return composeWeek({
      weekStartISO,
      now,
      vertical,
      events,
      blocks,
      workStartMin: settings?.work_start_minutes ?? WORK_START_DEFAULT,
      workEndMin: settings?.work_end_minutes ?? WORK_END_DEFAULT,
      hiddenCalendarIds: settings?.hidden_calendar_ids ?? [],
      hiddenEventKeys: (settings?.hidden_events ?? []).map((h) => h.key),
      bigRocks,
      domainHours,
      ambient,
      sealed: isPast,
    });
  }, [weekStartISO, now, isPast, back, pastSprint, vertical, events, blocks, settings?.work_start_minutes, settings?.work_end_minutes, settings?.hidden_calendar_ids]);
}
