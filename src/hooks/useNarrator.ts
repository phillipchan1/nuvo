// The narrator: one LLM-voiced, gain-framed sentence over the measured
// deltas. Falls back to null (caller keeps its template sentence) if the
// function is unreachable — the numbers never depend on the model.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export interface NarratorStats {
  window: "week" | "quarter";
  doneCount: number;
  doneHours: number;
  byDomain: { name: string; hours: number; targetHours: number }[];
  moved: { name: string; from: number; to: number }[];
  shipped?: string[];
}

export function useNarrator(stats: NarratorStats | null): string | null {
  const { data } = useQuery({
    queryKey: ["narrator", stats ? JSON.stringify(stats) : "off"],
    enabled: Boolean(stats && (stats.doneCount > 0 || stats.moved.length > 0)),
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const { data: res, error } = await supabase.functions.invoke("agent", {
        body: { narrate: stats },
      });
      if (error) return null;
      return (res?.sentence as string) ?? null;
    },
  });
  return data ?? null;
}
