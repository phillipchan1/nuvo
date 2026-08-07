// useWeekVerdicts — cast or clear the landed verdict for a project on an
// ARBITRARY week, by week_start. (Was `useWeekSprintRocks`, which also carried
// the free-text priority editor and a "carry into next week" that appended rocks
// to a week whose slate is derived from spans — so nothing ever rendered them.
// Week membership is the project's span; the rock is only ever the verdict.)
//
// Why not `useVertical().togglePushLanded`: that writes `data.sprint`, which is
// keyed on `planningWeekStartISO()` — on a SATURDAY that's already *next*
// Monday, while the Week's Plan is still showing the week that's ending. Tapping
// a verdict then would land it on the wrong week's row. This is week-correct;
// both writers share `upsertPushVerdict` so the rule itself exists once.
//
// Shares the ["sprint", weekStart] cache key with useVertical, so the current
// week stays in sync. Writes upsert the sprint row (creating it on first use).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";
import { upsertPushVerdict } from "../lib/priorities";
import { useVertical } from "./useVertical";
import type { Sprint } from "../lib/types";

export interface WeekVerdicts {
  /** land / un-land a project on this week. */
  setLanded: (projectId: string, landed: boolean) => void;
}

export function useWeekVerdicts(weekStartISO: string): WeekVerdicts {
  const qc = useQueryClient();
  const { data: vertical } = useVertical();
  const { data: sprint } = useQuery({
    queryKey: ["sprint", weekStartISO],
    queryFn: async (): Promise<Sprint | null> => {
      const { data, error } = await supabase.from("sprints").select("*").eq("week_start", weekStartISO).maybeSingle();
      if (error) throw error;
      return data as Sprint | null;
    },
  });
  const rocks = sprint?.big_rocks ?? [];

  return {
    setLanded: (projectId, landed) => {
      const project = vertical.projects.find((p) => p.id === projectId);
      const next = upsertPushVerdict(
        rocks,
        { id: projectId, name: project?.name ?? "", outcome: project?.outcome ?? "" },
        landed,
        new Date().toISOString(),
      );
      if (next === rocks) return; // clearing a verdict that was never cast
      void (async () => {
        qc.setQueryData<Sprint | null>(["sprint", weekStartISO], (old) =>
          old ? { ...old, big_rocks: next } : ({ week_start: weekStartISO, big_rocks: next } as unknown as Sprint),
        );
        // Addressed by the week — `sprints` is natural-keyed in the transport,
        // and the upsert's conflict target is the same (user_id, week_start)
        // uniqueness this used to name by hand.
        await queueWrite(makeOp("sprints", "insert", weekStartISO, { big_rocks: next }));
        invalidateWhenSafe(qc, "sprints", ["sprint", weekStartISO]);
        invalidateWhenSafe(qc, "sprints", ["vertical"]);
      })();
    },
  };
}
