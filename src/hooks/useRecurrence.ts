import { useCallback } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { makeOp, queueWrite } from "../lib/sync";
import { patchCaches } from "./useTasks";
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


/**
 * Which dates a series already has occupied, read from the caches the rest of
 * the app already fills. This is the local answer to the
 * `select recurrence_date where recurrence_id = …` that used to gate
 * materialisation on the network.
 *
 * It reads every `["tasks"]` / `["slots"]` fragment, not just the "all" one:
 * a freshly queued occurrence is patched into whichever filtered list it joins,
 * and missing it would materialise the same date twice.
 */
function occurrenceDates(
  qc: QueryClient,
  kind: "task" | "slot",
  recurrenceId: string,
): Set<string> | null {
  const root = kind === "task" ? "tasks" : "slots";
  // The unfiltered pool is the only cache that can answer authoritatively —
  // every other fragment is date- or status-filtered and would under-report.
  // Null when it has not loaded: the caller must skip, not assume empty.
  const pool = qc.getQueryData<{ recurrence_id?: string | null; recurrence_date?: string | null }[]>(
    root === "tasks" ? ["tasks", "all"] : ["slots"],
  );
  if (!pool) return null;

  const dates = new Set<string>();
  for (const [, rows] of qc.getQueriesData<{ recurrence_id?: string | null; recurrence_date?: string | null }[]>({
    queryKey: [root],
  })) {
    for (const r of rows ?? []) {
      if (r.recurrence_id === recurrenceId && r.recurrence_date) dates.add(r.recurrence_date);
    }
  }
  return dates;
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
  /**
   * Fill in a series' missing occurrences, entirely from the cache.
   *
   * This used to ask the server which dates already existed, and that single
   * read is what kept recurrences online-only (N-15): queued offline, you got a
   * series row with no occurrences — a commitment that displayed but did not
   * exist. The client already holds every task and slot with its
   * `recurrence_id` / `recurrence_date`, so the question is answerable locally
   * and materialisation becomes a pure computation plus queued writes.
   *
   * Resolves true only when it actually wrote occurrences — see `materializeAll`.
   */
  const materializeSeries = useCallback(async (rec: Recurrence, fromISO: string): Promise<boolean> => {
    const toISO = toDateISO(addDays(parseDateISO(todayISO()), HORIZON_DAYS));
    const dates = expandRule(ruleOf(rec), rec.anchor_date, fromISO, toISO, rec.exdates);
    if (dates.length === 0) return false;

    // "I cannot see any occurrences" and "there are no occurrences" are
    // different facts, and conflating them is catastrophic here: materialise
    // runs on app open, potentially before the task query has resolved, so an
    // unloaded cache made every date in the horizon look missing and queued a
    // fresh insert for each one. Observed: 385 ops, every one rejected by
    // `tasks_recurrence_occurrence_uniq` and parked. Unknown must mean skip.
    const have = occurrenceDates(qc, rec.kind, rec.id);
    if (!have) return false;
    const missing = dates.filter((d) => !have.has(d));
    if (missing.length === 0) return false;

    if (rec.kind === "task") {
      // One op per occurrence with a client-minted id. A batch insert has no
      // safe retry — a half-landed batch leaves the series with holes and the
      // replay cannot tell which rows made it. Per-row upserts are each
      // idempotent, so a partial delivery simply completes on the next drain.
      for (const d of missing) {
        await queueWrite(
          makeOp("tasks", "insert", crypto.randomUUID(), {
            title: rec.title,
            status: "planned",
            do_date: d,
            start_time: rec.time_of_day_minutes != null ? occurrenceStartISO(d, rec.time_of_day_minutes) : null,
            duration_minutes: rec.duration_minutes,
            priority: rec.priority,
            project_id: rec.project_id,
            domain_id: rec.domain_id,
            recurrence_id: rec.id,
            recurrence_date: d,
          }),
        );
      }
    } else {
      const minutes = rec.time_of_day_minutes ?? 9 * 60;
      for (const d of missing) {
        await queueWrite(
          makeOp("slots", "insert", crypto.randomUUID(), {
            title: rec.title,
            do_date: d,
            start_time: occurrenceStartISO(d, minutes),
            duration_minutes: rec.duration_minutes,
            project_id: rec.project_id,
            domain_id: rec.domain_id,
            color: rec.color,
            recurrence_id: rec.id,
            recurrence_date: d,
          }),
        );
      }
    }

    await queueWrite(makeOp("recurrences", "update", rec.id, { last_materialized: toISO }));
    return true;
  }, [qc]);

  /**
   * Top up every active series — called on app open and after rollover.
   *
   * Returns **false when it declined to run** because the occurrence pool had
   * not loaded yet. Callers must not record it as done in that case: the mobile
   * shell materialises at most once per day, so treating a cold-cache skip as a
   * completed run would mean no occurrences appear for the rest of the day.
   */
  const materializeAll = useCallback(async (): Promise<boolean> => {
    const { data } = await supabase.from("recurrences").select(REC_COLS).eq("active", true);
    const recs = (data ?? []) as Recurrence[];
    if (!recs.length) return true;

    // Bail before writing anything if we cannot see what already exists —
    // guessing "nothing" here is what queued 385 duplicate occurrences.
    const kinds = new Set(recs.map((r) => r.kind));
    for (const kind of kinds) {
      if (occurrenceDates(qc, kind, "__probe__") === null) return false;
    }

    const today = todayISO();
    // Series are independent — each reads and tops up only its own occurrences.
    // Awaiting them one at a time cost a full round-trip per series on every app
    // open (measured: three series = ~330ms of pure serialization) and, worse,
    // pushed the task queries that actually render the screen behind all of it.
    // `allSettled` keeps the existing per-series error tolerance: one bad series
    // must not stop the rest from topping up.
    const results = await Promise.allSettled(recs.map((rec) => materializeSeries(rec, today)));
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.warn("[nuvo] materialize failed for series", recs[i].id, r.reason);
      }
    });
    // Only when something was actually written. This used to invalidate on
    // `recs.length` — i.e. on every app open for any account with an active
    // series — which re-ran the whole task and slot query set a second time for
    // no reason. Measured: 27 boot requests instead of 16, with the duplicate
    // round landing ~450ms after the first and re-rendering everything.
    if (results.some((r) => r.status === "fulfilled" && r.value)) invalidate();
    return true;
  }, [materializeSeries, invalidate, qc]);

  /** Insert just the series row (no occurrences yet). */
  const insertRecurrence = useCallback(
    async (input: {
      kind: "task" | "slot";
      rule: RecurrenceRule;
      anchorISO: string;
      template: SeriesTemplate;
    }): Promise<Recurrence> => {
      const { kind, rule, anchorISO, template } = input;
      const id = crypto.randomUUID();
      const row: Record<string, unknown> = {
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
      };

      const rec = { id, active: true, exdates: [], last_materialized: null, ...row } as unknown as Recurrence;
      qc.setQueryData<Recurrence[]>(["recurrences"], (old) => (old ? [...old, rec] : [rec]));
      await queueWrite(makeOp("recurrences", "insert", id, row));
      return rec;
    },
    [qc],
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
      await queueWrite(
        makeOp(kind === "task" ? "tasks" : "slots", "update", row.id, {
          recurrence_id: rec.id,
          recurrence_date: anchorISO,
        }),
      );
      await materializeSeries(rec, anchorISO);
      invalidate();
    },
    [insertRecurrence, materializeSeries, invalidate],
  );

  /**
   * Detach + tear down future, non-pinned, non-done occurrences of a series.
   *
   * The four predicates this used to send to the server (`recurrence_id`,
   * `recurrence_overridden`, `status`, `do_date >=`) are evaluated against the
   * cache instead. A predicate the server resolves days later would match a
   * different set than the user saw when they edited the rule — and could trash
   * occurrences they created in between.
   */
  const clearFuture = useCallback(async (
    recurrenceId: string,
    fromISO: string,
    /** `deleteFollowing` tears down pinned occurrences too — an explicit
     *  "delete this and everything after" outranks a per-occurrence override,
     *  where a rule *edit* deliberately leaves them alone. */
    opts?: { includeOverridden?: boolean },
  ) => {
    const rows = <T extends { id: string }>(root: string): T[] => {
      const seen = new Map<string, T>();
      for (const [, list] of qc.getQueriesData<T[]>({ queryKey: [root] })) {
        for (const r of list ?? []) seen.set(r.id, r);
      }
      return [...seen.values()];
    };

    // tasks → trash (the status patch makes task-mirror delete the Google event)
    const doomedTasks = rows<Task>("tasks").filter(
      (t) =>
        t.recurrence_id === recurrenceId &&
        (opts?.includeOverridden || !t.recurrence_overridden) &&
        t.status !== "done" &&
        (t.do_date ?? "") >= fromISO,
    );
    for (const t of doomedTasks) {
      patchCaches(qc, t.id, { status: "trashed", recurrence_id: null, recurrence_date: null });
      await queueWrite(
        makeOp("tasks", "update", t.id, {
          status: "trashed",
          recurrence_id: null,
          recurrence_date: null,
        }),
      );
      if (t.google_event_id && navigator.onLine) invokeQuiet("task-mirror", { taskId: t.id });
    }

    // slots → delete (children orphan back to normal tasks via FK)
    const doomedSlots = rows<Slot>("slots").filter(
      (sl) =>
        sl.recurrence_id === recurrenceId &&
        (opts?.includeOverridden || !sl.recurrence_overridden) &&
        (sl.do_date ?? "") >= fromISO,
    );
    for (const sl of doomedSlots) {
      if (sl.google_event_id && navigator.onLine) {
        invokeQuiet("slot-mirror", { slotId: sl.id, deleted: true, googleEventId: sl.google_event_id });
      }
      await queueWrite(makeOp("slots", "delete", sl.id));
    }
  }, [qc]);

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
      qc.setQueryData<Recurrence[]>(["recurrences"], (old) =>
        old?.map((r) => (r.id === rec.id ? ({ ...r, ...patch } as Recurrence) : r)),
      );
      await queueWrite(makeOp("recurrences", "update", rec.id, patch));
      // Materialise from the locally-merged series rather than a returned row —
      // there is no returned row when the patch is still in the outbox.
      await materializeSeries({ ...rec, ...patch } as Recurrence, today);
      invalidate();
    },
    [clearFuture, materializeSeries, invalidate, qc],
  );

  /** Stop repeating from `fromISO` on: keep this & earlier as normal items. */
  const stopSeries = useCallback(
    async (rec: Recurrence, fromISO: string) => {
      // remove everything strictly after this date…
      await clearFuture(rec.id, toDateISO(addDays(parseDateISO(fromISO), 1)));
      // …detach what remains so it lives on as ordinary tasks/slots…
      const root = rec.kind === "task" ? "tasks" : "slots";
      const seen = new Set<string>();
      for (const [, list] of qc.getQueriesData<{ id: string; recurrence_id?: string | null }[]>({
        queryKey: [root],
      })) {
        for (const r of list ?? []) if (r.recurrence_id === rec.id) seen.add(r.id);
      }
      for (const id of seen) {
        if (root === "tasks") patchCaches(qc, id, { recurrence_id: null, recurrence_date: null });
        await queueWrite(makeOp(root, "update", id, { recurrence_id: null, recurrence_date: null }));
      }
      // …and retire the series.
      await queueWrite(makeOp("recurrences", "update", rec.id, { active: false }));
      invalidate();
    },
    [clearFuture, invalidate, qc],
  );

  /** Delete this occurrence and every later one; truncate (or drop) the rule. */
  const deleteFollowing = useCallback(
    async (rec: Recurrence, fromISO: string) => {
      // Was a near-copy of clearFuture with one predicate changed. Same act,
      // same teardown — the only difference is that an explicit "and
      // everything after" also takes the pinned occurrences.
      await clearFuture(rec.id, fromISO, { includeOverridden: true });
      const until = toDateISO(addDays(parseDateISO(fromISO), -1));
      if (until < rec.anchor_date) {
        await queueWrite(makeOp("recurrences", "delete", rec.id));
      } else {
        await queueWrite(makeOp("recurrences", "update", rec.id, { until_date: until, active: true }));
      }
      invalidate();
    },
    [clearFuture, invalidate],
  );

  /** Delete just one occurrence and never regenerate it (exdate). */
  const skipOccurrence = useCallback(
    async (rec: Recurrence, dateISO: string) => {
      await queueWrite(makeOp("recurrences", "update", rec.id, { exdates: [...rec.exdates, dateISO] }));
      invalidate();
    },
    [invalidate],
  );

  /** Delete the whole series: retire the rule + drop all non-done occurrences. */
  const deleteSeries = useCallback(
    async (rec: Recurrence) => {
      await clearFuture(rec.id, "1900-01-01", { includeOverridden: true });
      // Whatever survived the teardown (done occurrences) is detached so it
      // lives on as ordinary work rather than dangling at a deleted series.
      const root = rec.kind === "task" ? "tasks" : "slots";
      const survivors = new Set<string>();
      for (const [, list] of qc.getQueriesData<{ id: string; recurrence_id?: string | null }[]>({
        queryKey: [root],
      })) {
        for (const r of list ?? []) if (r.recurrence_id === rec.id) survivors.add(r.id);
      }
      for (const id of survivors) {
        if (root === "tasks") patchCaches(qc, id, { recurrence_id: null, recurrence_date: null });
        await queueWrite(makeOp(root, "update", id, { recurrence_id: null, recurrence_date: null }));
      }
      await queueWrite(makeOp("recurrences", "delete", rec.id));
      invalidate();
    },
    [clearFuture, invalidate, qc],
  );

  const pauseSeries = useCallback(
    async (recurrenceId: string) => {
      await queueWrite(makeOp("recurrences", "update", recurrenceId, { active: false }));
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
