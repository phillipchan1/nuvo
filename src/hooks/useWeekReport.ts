// useWeekReport — the Week's Plan / Review data for a given week, composed
// deterministically (composeWeek). The CURRENT week is forming and fully live.
// Past weeks prefer a sealed week_reviews snapshot when one exists; otherwise
// they recompose from the week's sprint + Domain.weeks pulse.

import { useMemo } from "react";
import { addDays, differenceInCalendarWeeks, startOfWeek } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { parseDateISO } from "../lib/dates";
import { supabase } from "../lib/supabase";
import { useVertical } from "./useVertical";
import { useExternalEvents } from "./useCalendar";
import { useScheduledTasks } from "./useTasks";
import { useSettings } from "./useSettings";
import { useEventRouting } from "./useEventRouting";
import { useActivityUnits } from "./useActivity";
import { useWeekReviewRow } from "./useWeekReview";
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

function isFullReport(r: unknown): r is WeekReport {
  return !!r && typeof r === "object" && "emblem" in r && "domains" in r && "evidence" in r;
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
  const eventRouting = useEventRouting();
  const { data: activityUnits = [] } = useActivityUnits(startISO, endISO);
  const sealedRow = useWeekReviewRow(weekStartISO);

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
    // Prefer a durable sealed snapshot for past weeks (evidence + Find intact).
    if (isPast && isFullReport(sealedRow.data?.report)) {
      const snap = sealedRow.data!.report;
      // Overlay warmer narration if stored separately.
      if (sealedRow.data?.find_narration && snap.find) {
        return {
          ...snap,
          find: {
            ...snap.find,
            headline: sealedRow.data.find_narration.headline,
            detail: sealedRow.data.find_narration.detail,
          },
        };
      }
      return snap;
    }

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
      calendarDomainMap: settings?.calendar_domain_map ?? {},
      eventRouting,
      activityUnits,
      weeksBack: back,
    });
  }, [
    weekStartISO,
    now,
    isPast,
    back,
    pastSprint,
    vertical,
    events,
    blocks,
    settings,
    eventRouting,
    activityUnits,
    sealedRow.data,
  ]);
}
