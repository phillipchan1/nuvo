// useWeekReview — sealed Review persistence + Find feedback.
// Live composition (useWeekReport) is the source for the current week; past
// weeks prefer a sealed snapshot when one exists, else fall back to live recompute.

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { WeekReport } from "../lib/composeWeek";

export type FindResponse = "confirmed" | "corrected" | "dismissed" | "kept";

export interface WeekReviewRow {
  id: string;
  week_start: string;
  report: WeekReport;
  find_narration: { headline: string; detail: string } | null;
  find_response: FindResponse | null;
  find_kept: boolean;
  note_to_monday: string | null;
  note_to_monday_seen_at: string | null;
  sealed_at: string;
}

const KEY = ["week_reviews"] as const;

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

/** Ensure a week_reviews row exists without clobbering an existing report. */
async function ensureRow(weekStartISO: string): Promise<void> {
  const userId = await uid();
  const { data } = await supabase
    .from("week_reviews")
    .select("id")
    .eq("week_start", weekStartISO)
    .maybeSingle();
  if (data) return;
  const { error } = await supabase.from("week_reviews").insert({
    user_id: userId,
    week_start: weekStartISO,
    report: {},
  });
  // Unique race: another writer won — fine.
  if (error && error.code !== "23505") throw error;
}

export function useWeekReviewRow(weekStartISO: string) {
  return useQuery({
    queryKey: [...KEY, weekStartISO],
    queryFn: async (): Promise<WeekReviewRow | null> => {
      const { data, error } = await supabase
        .from("week_reviews")
        .select("id, week_start, report, find_narration, find_response, find_kept, note_to_monday, note_to_monday_seen_at, sealed_at")
        .eq("week_start", weekStartISO)
        .maybeSingle();
      if (error) throw error;
      return (data as WeekReviewRow | null) ?? null;
    },
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
}

/** Every sealed week, newest first — the archive gallery's data. A row only
 *  counts once it carries a full report (the same "emblem" in report" check
 *  WeekPlanBody uses before treating a snapshot as the historical record);
 *  `ensureRow` leaves behind empty placeholder rows this must skip. */
export function useWeekReviewList() {
  return useQuery({
    queryKey: [...KEY, "list"],
    queryFn: async (): Promise<WeekReviewRow[]> => {
      const { data, error } = await supabase
        .from("week_reviews")
        .select("id, week_start, report, find_narration, find_response, find_kept, note_to_monday, note_to_monday_seen_at, sealed_at")
        .order("week_start", { ascending: false });
      if (error) throw error;
      return ((data as WeekReviewRow[] | null) ?? []).filter(
        (row) => row.report && typeof row.report === "object" && "emblem" in row.report,
      );
    },
    staleTime: 60_000,
    meta: { silent: true },
  });
}

// NOTE: `useNoteToMonday` lived here and was read only by NowFloor's banner. It
// went with the Today rung. The Review still *writes* `note_to_monday` (see
// WeekFind) — the note needs a new reader on the Schedule to close the loop.

export function useWeekReviewActions(weekStartISO: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEY });
  };

  const seal = useMutation({
    mutationFn: async (report: WeekReport) => {
      const userId = await uid();
      const { data, error } = await supabase
        .from("week_reviews")
        .upsert(
          {
            user_id: userId,
            week_start: weekStartISO,
            report,
            sealed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,week_start" },
        )
        .select("id, week_start, report, find_narration, find_response, find_kept, note_to_monday, note_to_monday_seen_at, sealed_at")
        .single();
      if (error) throw error;
      return data as WeekReviewRow;
    },
    onSuccess: invalidate,
  });

  const setFindResponse = useMutation({
    mutationFn: async ({ response, kept }: { response: FindResponse; kept?: boolean }) => {
      await ensureRow(weekStartISO);
      const { error } = await supabase
        .from("week_reviews")
        .update({
          find_response: response,
          find_kept: kept ?? response === "kept",
        })
        .eq("week_start", weekStartISO);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setFindNarration = useMutation({
    mutationFn: async (narration: { headline: string; detail: string }) => {
      await ensureRow(weekStartISO);
      const { error } = await supabase
        .from("week_reviews")
        .update({ find_narration: narration })
        .eq("week_start", weekStartISO);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setNoteToMonday = useMutation({
    mutationFn: async (note: string) => {
      await ensureRow(weekStartISO);
      const { error } = await supabase
        .from("week_reviews")
        .update({ note_to_monday: note.trim() || null })
        .eq("week_start", weekStartISO);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markNoteSeen = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("week_reviews")
        .update({ note_to_monday_seen_at: new Date().toISOString() })
        .eq("week_start", weekStartISO);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reseal = useCallback((report: WeekReport) => seal.mutateAsync(report), [seal]);

  return {
    seal,
    reseal,
    setFindResponse,
    setFindNarration,
    setNoteToMonday,
    markNoteSeen,
  };
}
