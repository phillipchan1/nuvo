// useWeekReview — sealed Review persistence + Find feedback.
// Live composition (useWeekReport) is the source for the current week; past
// weeks prefer a sealed snapshot when one exists, else fall back to live recompute.

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";
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


/**
 * Ensure a week_reviews row exists without clobbering an existing report.
 *
 * Queued, and addressed by the **week**, not by a uuid. There is one row per
 * week, and an offline client cannot learn the server's id for it — minting one
 * would risk a second row for the same week and a `23505` that parks the whole
 * review. The transport declares `week_start` as this table's identity and
 * upserts on `(user_id, week_start)`, which is exactly the ensure this used to
 * do with a read-then-insert (and without its lost-race window).
 */
async function ensureRow(weekStartISO: string): Promise<void> {
  await queueWrite(makeOp("week_reviews", "insert", weekStartISO, { report: {} }));
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
  const invalidate = () => invalidateWhenSafe(qc, "week_reviews", KEY);

  /** Every write addresses the row by its week — see `ensureRow`. */
  const patchWeek = async (patch: Record<string, unknown>) => {
    qc.setQueryData<WeekReviewRow | null>([...KEY, weekStartISO], (old) =>
      old ? ({ ...old, ...patch } as WeekReviewRow) : old,
    );
    await queueWrite(makeOp("week_reviews", "update", weekStartISO, patch));
    invalidateWhenSafe(qc, "week_reviews", KEY);
  };

  const seal = useMutation({
    mutationFn: async (report: WeekReport) => {
      // Ensure-then-patch. The two fold into one upsert before they leave the
      // device, and `week_reviews` is declared merge-on-conflict precisely so
      // that folded insert still writes the report over a placeholder row
      // instead of being ignored as a duplicate.
      await ensureRow(weekStartISO);
      await patchWeek({ report, sealed_at: new Date().toISOString() });
    },
    onSuccess: invalidate,
  });

  const setFindResponse = useMutation({
    mutationFn: async ({ response, kept }: { response: FindResponse; kept?: boolean }) => {
      await ensureRow(weekStartISO);
      await patchWeek({ find_response: response, find_kept: kept ?? response === "kept" });
    },
    onSuccess: invalidate,
  });

  const setFindNarration = useMutation({
    mutationFn: async (narration: { headline: string; detail: string }) => {
      await ensureRow(weekStartISO);
      await patchWeek({ find_narration: narration });
    },
    onSuccess: invalidate,
  });

  const setNoteToMonday = useMutation({
    mutationFn: async (note: string) => {
      await ensureRow(weekStartISO);
      await patchWeek({ note_to_monday: note.trim() || null });
    },
    onSuccess: invalidate,
  });

  const markNoteSeen = useMutation({
    mutationFn: async () => {
      await patchWeek({ note_to_monday_seen_at: new Date().toISOString() });
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
