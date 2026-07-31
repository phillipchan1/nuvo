import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import {
  DEFAULT_DURATION_MINUTES,
  type Recurrence,
  ruleOf,
  type Slot,
  type Task,
} from "../lib/types";
import { HORIZON_DAYS, expandRule, type RecurrenceRule } from "../lib/recurrence";
import { addDays } from "date-fns";
import { parseDateISO, toDateISO, todayISO } from "../lib/dates";

export { HORIZON_DAYS } from "../lib/recurrence";

const REC_COLS =
  "id, user_id, kind, freq, interval, byweekday, bymonthday, anchor_date, until_date, max_count, exdates, title, duration_minutes, time_of_day_minutes, project_id, domain_id, priority, color, active, last_materialized";

/** Local ISO instant for a date + minutes-after-midnight (app lives in APP_TZ). */
function occurrenceStartISO(dateISO: string, minutes: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0).toISOString();
}

/** The template payload shared by both create paths. */
export interface SeriesTemplate {
  title: string;
  duration_minutes: number;
  /** Start minutes-after-midnight; null = a dated to-do with no block (tasks). */
  time_of_day_minutes: number | null;
  project_id?: string | null;
  domain_id?: string | null;
  priority?: Task["priority"];
  color?: string | null;
}

/** Every active series — drives top-up materialization and rule lookups. */
export function useRecurrences() {
  return useQuery({
    queryKey: ["recurrences"],
    queryFn: async (): Promise<Recurrence[]> => {
      const { data, error } = await supabase.from("recurrences").select(REC_COLS).eq("active", true);
      if (error) throw error;
      return data as Recurrence[];
    },
  });
}

export function useRecurrenceMutations() {
  const qc = useQueryClient();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["slots"] });
    qc.invalidateQueries({ queryKey: ["recurrences"] });
  }, [qc]);

  /**
   * Fill in every missing occurrence of one series within [from, horizon],
   * skipping exdates and dates that already have a row.
   *
   * Note: occurrences are NOT pushed to the Google "Nuvo" mirror here. Firing
   * one mirror write per occurrence meant ~25 concurrent edge-function calls,
   * which race on the shared OAuth token refresh and cascade into 500s. The
   * rows live in Nuvo regardless; phone-mirroring a series is a follow-up.
   */
  const materializeSeries = useCallback(async (rec: Recurrence, fromISO: string) => {
    const toISO = toDateISO(addDays(parseDateISO(todayISO()), HORIZON_DAYS));
    const dates = expandRule(ruleOf(rec), rec.anchor_date, fromISO, toISO, rec.exdates);
    if (dates.length === 0) return;

    const table = rec.kind === "task" ? "tasks" : "slots";
    const { data: existing } = await supabase
      .from(table)
      .select("recurrence_date")
      .eq("recurrence_id", rec.id);
    const have = new Set((existing ?? []).map((r) => (r as { recurrence_date: string }).recurrence_date));
    const missing = dates.filter((d) => !have.has(d));
    if (missing.length === 0) return;

    const { data: { session } } = await supabase.auth.getSession();
    const userId = rec.user_id ?? session?.user?.id;
    if (!userId) return;

    if (rec.kind === "task") {
      const rows = missing.map((d) => ({
        user_id: userId,
        title: rec.title,
        status: "planned" as const,
        do_date: d,
        start_time: rec.time_of_day_minutes != null ? occurrenceStartISO(d, rec.time_of_day_minutes) : null,
        duration_minutes: rec.duration_minutes,
        priority: rec.priority,
        project_id: rec.project_id,
        domain_id: rec.domain_id,
        recurrence_id: rec.id,
        recurrence_date: d,
      }));
      const { error } = await supabase.from("tasks").insert(rows);
      if (error) { if (error.code !== "23505") throw error; return; }
    } else {
      const minutes = rec.time_of_day_minutes ?? 9 * 60;
      const rows = missing.map((d) => ({
        user_id: userId,
        title: rec.title,
        do_date: d,
        start_time: occurrenceStartISO(d, minutes),
        duration_minutes: rec.duration_minutes,
        project_id: rec.project_id,
        domain_id: rec.domain_id,
        color: rec.color,
        recurrence_id: rec.id,
        recurrence_date: d,
      }));
      const { error } = await supabase.from("slots").insert(rows);
      if (error) { if (error.code !== "23505") throw error; return; }
    }

    await supabase.from("recurrences").update({ last_materialized: toISO }).eq("id", rec.id);
  }, []);

  /** Top up every active series — called on app open and after rollover. */
  const materializeAll = useCallback(async () => {
    const { data } = await supabase.from("recurrences").select(REC_COLS).eq("active", true);
    const recs = (data ?? []) as Recurrence[];
    const today = todayISO();
    for (const rec of recs) {
      try { await materializeSeries(rec, today); } catch (e) {
        console.warn("[nuvo] materialize failed for series", rec.id, e);
      }
    }
    if (recs.length) invalidate();
  }, [materializeSeries, invalidate]);

  /** Insert just the series row (no occurrences yet). */
  const insertRecurrence = useCallback(
    async (input: {
      kind: "task" | "slot";
      rule: RecurrenceRule;
      anchorISO: string;
      template: SeriesTemplate;
    }): Promise<Recurrence> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not signed in");
      const { kind, rule, anchorISO, template } = input;
      const { data, error } = await supabase
        .from("recurrences")
        .insert({
          user_id: session.user.id,
          kind,
          freq: rule.freq,
          interval: rule.interval,
          byweekday: rule.byweekday ?? [],
          bymonthday: rule.bymonthday ?? null,
          anchor_date: anchorISO,
          until_date: rule.until ?? null,
          max_count: rule.count ?? null,
          title: template.title,
          duration_minutes: template.duration_minutes || DEFAULT_DURATION_MINUTES,
          time_of_day_minutes: template.time_of_day_minutes,
          project_id: template.project_id ?? null,
          domain_id: template.domain_id ?? null,
          priority: template.priority ?? "none",
          color: template.color ?? null,
        })
        .select(REC_COLS)
        .single();
      if (error) throw error;
      return data as Recurrence;
    },
    [],
  );

  /** Create a brand-new repeating series and lay down its first occurrences. */
  const createSeries = useCallback(
    async (input: {
      kind: "task" | "slot";
      rule: RecurrenceRule;
      anchorISO: string;
      template: SeriesTemplate;
    }): Promise<Recurrence> => {
      const rec = await insertRecurrence(input);
      await materializeSeries(rec, input.anchorISO);
      invalidate();
      return rec;
    },
    [insertRecurrence, materializeSeries, invalidate],
  );

  /** Turn a single existing task/slot into the anchor of a new series. */
  const convertToSeries = useCallback(
    async (kind: "task" | "slot", row: Task | Slot, rule: RecurrenceRule, template: SeriesTemplate) => {
      const anchorISO = row.do_date ?? todayISO();
      const rec = await insertRecurrence({ kind, rule, anchorISO, template });
      // Adopt the existing row as occurrence #1 *before* materializing, so the
      // anchor date is already taken and never gets a duplicate.
      await supabase
        .from(kind === "task" ? "tasks" : "slots")
        .update({ recurrence_id: rec.id, recurrence_date: anchorISO })
        .eq("id", row.id);
      await materializeSeries(rec, anchorISO);
      invalidate();
    },
    [insertRecurrence, materializeSeries, invalidate],
  );

  /** Detach + tear down future, non-pinned, non-done occurrences of a series. */
  const clearFuture = useCallback(async (recurrenceId: string, fromISO: string) => {
    // tasks → trash (the status patch makes task-mirror delete the Google event)
    const { data: ts } = await supabase
      .from("tasks")
      .select("id, google_event_id")
      .eq("recurrence_id", recurrenceId)
      .eq("recurrence_overridden", false)
      .neq("status", "done")
      .gte("do_date", fromISO);
    if (ts && ts.length) {
      await supabase
        .from("tasks")
        .update({ status: "trashed", recurrence_id: null, recurrence_date: null })
        .eq("recurrence_id", recurrenceId)
        .eq("recurrence_overridden", false)
        .neq("status", "done")
        .gte("do_date", fromISO);
      for (const t of ts) {
        if ((t as { google_event_id: string | null }).google_event_id) {
          invokeQuiet("task-mirror", { taskId: (t as { id: string }).id });
        }
      }
    }
    // slots → delete (children orphan back to normal tasks via FK)
    const { data: ss } = await supabase
      .from("slots")
      .select("id, google_event_id")
      .eq("recurrence_id", recurrenceId)
      .eq("recurrence_overridden", false)
      .gte("do_date", fromISO);
    if (ss && ss.length) {
      for (const s of ss) {
        const gid = (s as { google_event_id: string | null }).google_event_id;
        if (gid) invokeQuiet("slot-mirror", { slotId: (s as { id: string }).id, deleted: true, googleEventId: gid });
      }
      await supabase
        .from("slots")
        .delete()
        .eq("recurrence_id", recurrenceId)
        .eq("recurrence_overridden", false)
        .gte("do_date", fromISO);
    }
  }, []);

  /** Change the rule and/or template of a series — regenerates from today. */
  const updateSeries = useCallback(
    async (rec: Recurrence, rule: RecurrenceRule, template?: Partial<SeriesTemplate>) => {
      const today = todayISO();
      await clearFuture(rec.id, today);
      const patch: Record<string, unknown> = {
        freq: rule.freq,
        interval: rule.interval,
        byweekday: rule.byweekday ?? [],
        bymonthday: rule.bymonthday ?? null,
        until_date: rule.until ?? null,
        max_count: rule.count ?? null,
        ...(template ?? {}),
      };
      const { data } = await supabase
        .from("recurrences")
        .update(patch)
        .eq("id", rec.id)
        .select(REC_COLS)
        .single();
      if (data) await materializeSeries(data as Recurrence, today);
      invalidate();
    },
    [clearFuture, materializeSeries, invalidate],
  );

  /** Stop repeating from `fromISO` on: keep this & earlier as normal items. */
  const stopSeries = useCallback(
    async (rec: Recurrence, fromISO: string) => {
      // remove everything strictly after this date…
      await clearFuture(rec.id, toDateISO(addDays(parseDateISO(fromISO), 1)));
      // …detach what remains so it lives on as ordinary tasks/slots…
      await supabase
        .from(rec.kind === "task" ? "tasks" : "slots")
        .update({ recurrence_id: null, recurrence_date: null })
        .eq("recurrence_id", rec.id);
      // …and retire the series.
      await supabase.from("recurrences").update({ active: false }).eq("id", rec.id);
      invalidate();
    },
    [clearFuture, invalidate],
  );

  /** Delete this occurrence and every later one; truncate (or drop) the rule. */
  const deleteFollowing = useCallback(
    async (rec: Recurrence, fromISO: string) => {
      const { data: ts } = await supabase
        .from("tasks")
        .select("id, google_event_id")
        .eq("recurrence_id", rec.id)
        .neq("status", "done")
        .gte("do_date", fromISO);
      if (ts && ts.length) {
        await supabase
          .from("tasks")
          .update({ status: "trashed", recurrence_id: null, recurrence_date: null })
          .eq("recurrence_id", rec.id)
          .neq("status", "done")
          .gte("do_date", fromISO);
        for (const t of ts) {
          if ((t as { google_event_id: string | null }).google_event_id) {
            invokeQuiet("task-mirror", { taskId: (t as { id: string }).id });
          }
        }
      }
      const { data: ss } = await supabase
        .from("slots")
        .select("id, google_event_id")
        .eq("recurrence_id", rec.id)
        .gte("do_date", fromISO);
      if (ss && ss.length) {
        for (const s of ss) {
          const gid = (s as { google_event_id: string | null }).google_event_id;
          if (gid) invokeQuiet("slot-mirror", { slotId: (s as { id: string }).id, deleted: true, googleEventId: gid });
        }
        await supabase.from("slots").delete().eq("recurrence_id", rec.id).gte("do_date", fromISO);
      }
      const until = toDateISO(addDays(parseDateISO(fromISO), -1));
      if (until < rec.anchor_date) {
        await supabase.from("recurrences").delete().eq("id", rec.id);
      } else {
        await supabase.from("recurrences").update({ until_date: until, active: true }).eq("id", rec.id);
      }
      invalidate();
    },
    [invalidate],
  );

  /** Delete just one occurrence and never regenerate it (exdate). */
  const skipOccurrence = useCallback(
    async (rec: Recurrence, dateISO: string) => {
      await supabase
        .from("recurrences")
        .update({ exdates: [...rec.exdates, dateISO] })
        .eq("id", rec.id);
      invalidate();
    },
    [invalidate],
  );

  /** Delete the whole series: retire the rule + drop all non-done occurrences. */
  const deleteSeries = useCallback(
    async (rec: Recurrence) => {
      await clearFuture(rec.id, "1900-01-01");
      await supabase
        .from(rec.kind === "task" ? "tasks" : "slots")
        .update({ recurrence_id: null, recurrence_date: null })
        .eq("recurrence_id", rec.id);
      await supabase.from("recurrences").delete().eq("id", rec.id);
      invalidate();
    },
    [clearFuture, invalidate],
  );

  const pauseSeries = useCallback(
    async (recurrenceId: string) => {
      await supabase.from("recurrences").update({ active: false }).eq("id", recurrenceId);
      invalidate();
    },
    [invalidate],
  );

  return {
    materializeSeries,
    materializeAll,
    createSeries,
    convertToSeries,
    updateSeries,
    stopSeries,
    skipOccurrence,
    deleteFollowing,
    deleteSeries,
    pauseSeries,
  };
}
