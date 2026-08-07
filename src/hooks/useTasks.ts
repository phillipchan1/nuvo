import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";
import { DEFAULT_DURATION_MINUTES, restingStatus, type Slot, type Task, type TaskPriority, type TaskStatus } from "../lib/types";
import { todayISO } from "../lib/dates";
import { needsGrooming } from "../lib/grooming";
import { useOptionalUndoStack } from "./useUndoStack";
import {
  COALESCE,
  resolveUndoTier,
  TASK_UNDO_DEFAULT,
  undoLabel,
  undoShortLabel,
  type UndoOpts,
} from "../lib/undoTiers";

const TASK_COLS = "*, task_labels(label_id)";

/** Fields a place/triage act moves — same four D-063a restores. */
type PlaceSnapshot = Pick<Task, "status" | "do_date" | "start_time" | "slot_id">;
type ScheduleSnapshot = PlaceSnapshot & Pick<Task, "duration_minutes">;
type CompleteSnapshot = Pick<Task, "status" | "completed_at">;

function placeSnap(t: Task): PlaceSnapshot {
  return { status: t.status, do_date: t.do_date, start_time: t.start_time, slot_id: t.slot_id };
}

function scheduleSnap(t: Task): ScheduleSnapshot {
  return { ...placeSnap(t), duration_minutes: t.duration_minutes };
}

function completeSnap(t: Task): CompleteSnapshot {
  return { status: t.status, completed_at: t.completed_at };
}

export function useInboxTasks() {
  return useQuery({
    queryKey: ["tasks", "inbox"],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_COLS)
        .eq("status", "inbox")
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });
}

/** All tasks for a given day (the Today list when date = today). */
export function useDayTasks(dateISO: string) {
  return useQuery({
    queryKey: ["tasks", "day", dateISO],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_COLS)
        .eq("do_date", dateISO)
        .in("status", ["planned", "done"])
        .is("slot_id", null) // slot children show inside their slot, not here
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });
}

/** Scheduled (time-blocked) tasks intersecting a calendar range. */
export function useScheduledTasks(rangeStartISO: string, rangeEndISO: string) {
  return useQuery({
    queryKey: ["tasks", "scheduled", rangeStartISO, rangeEndISO],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_COLS)
        .not("start_time", "is", null)
        .in("status", ["planned", "done"])
        .gte("start_time", rangeStartISO)
        .lt("start_time", rangeEndISO);
      if (error) throw error;
      return data as Task[];
    },
  });
}

/** Planned anytime tasks (do_date set, no start_time) within a date range.
 *  These appear as chips in the calendar's anytime row but are invisible to
 *  useScheduledTasks which requires start_time IS NOT NULL. */
export function usePlannedAnytimeTasks(rangeStartISO: string, rangeEndISO: string) {
  // do_date is a date column — extract date-only strings from the ISO range.
  const startDate = rangeStartISO.substring(0, 10);
  const endDate = rangeEndISO.substring(0, 10);
  return useQuery({
    queryKey: ["tasks", "anytime", startDate, endDate],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_COLS)
        .is("start_time", null)
        .is("slot_id", null) // slot children ride their slot, not the anytime row
        .not("do_date", "is", null)
        .in("status", ["planned"])
        .gte("do_date", startDate)
        .lt("do_date", endDate);
      if (error) throw error;
      return data as Task[];
    },
  });
}

/** Every non-trashed task, done included — same query key the vertical store
 *  fills, so this shares its cache (no second fetch). The Plan flow needs the
 *  raw rows to feed the composer; `VTask` drops the deadline ISO it relies on. */
export function useAllTasks() {
  return useQuery({
    queryKey: ["tasks", "all"],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .neq("status", "trashed")
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });
}

/** Every task committed to a sprint (the Week pool), done included. */
export function useSprintTasks(sprintId: string | null) {
  return useQuery({
    queryKey: ["tasks", "sprint", sprintId],
    enabled: Boolean(sprintId),
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_COLS)
        .eq("sprint_id", sprintId!)
        .neq("status", "trashed")
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });
}

/**
 * Patch a task across every cached task list. Filtered lists (inbox / day /
 * anytime / slot / scheduled) are membership-sensitive: a naive `.map` leaves
 * ghosts when a task *leaves* a list (e.g. assignToSlot stamps `slot_id` but
 * the day query still holds the row), and the rail then concatenates that
 * ghost with the slot-children fetch → duplicate rows. Drop or insert so each
 * cache matches what its queryFn would return.
 */
export function patchCaches(qc: QueryClient, id: string, patch: Partial<Task>) {
  // Resolve the post-patch row from any cache that already has it — needed when
  // inserting into a list the task is newly joining (slot children, etc.).
  let resolved: Task | null = null;
  for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
    const hit = data?.find((t) => t.id === id);
    if (hit) {
      resolved = { ...hit, ...patch };
      break;
    }
  }

  for (const [key, data] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
    if (!data) continue;
    const existing = data.find((t) => t.id === id);
    const next = existing ? { ...existing, ...patch } : resolved;
    const kind = key[1];

    let updated: Task[] | undefined;
    if (kind === "inbox") {
      const belongs = next != null && next.status === "inbox";
      if (!belongs) updated = data.filter((t) => t.id !== id);
      else if (existing) updated = data.map((t) => (t.id === id ? next! : t));
    } else if (kind === "day") {
      const dateISO = key[2] as string;
      const belongs =
        next != null &&
        !next.slot_id &&
        next.do_date === dateISO &&
        (next.status === "planned" || next.status === "done");
      if (!belongs) updated = data.filter((t) => t.id !== id);
      else if (existing) updated = data.map((t) => (t.id === id ? next! : t));
    } else if (kind === "anytime") {
      const startDate = key[2] as string;
      const endDate = key[3] as string;
      const belongs =
        next != null &&
        !next.start_time &&
        !next.slot_id &&
        next.do_date != null &&
        next.status === "planned" &&
        next.do_date >= startDate &&
        next.do_date < endDate;
      if (!belongs) updated = data.filter((t) => t.id !== id);
      else if (existing) updated = data.map((t) => (t.id === id ? next! : t));
    } else if (kind === "scheduled") {
      const rangeStart = key[2] as string;
      const rangeEnd = key[3] as string;
      const belongs =
        next != null &&
        next.start_time != null &&
        (next.status === "planned" || next.status === "done") &&
        next.start_time >= rangeStart &&
        next.start_time < rangeEnd;
      if (!belongs) updated = data.filter((t) => t.id !== id);
      else if (existing) updated = data.map((t) => (t.id === id ? next! : t));
    } else if (kind === "slot") {
      const slotIds = key[2] as string[];
      const belongs =
        next != null &&
        next.slot_id != null &&
        slotIds.includes(next.slot_id) &&
        next.status !== "trashed";
      if (!belongs) {
        updated = data.filter((t) => t.id !== id);
      } else if (existing) {
        updated = data.map((t) => (t.id === id ? next! : t));
      } else if (next) {
        // Entering a slot: the day/anytime caches drop it; insert here so the
        // rail doesn't flash empty while the slot query refetches.
        updated = [...data, next];
      }
    } else {
      // "all" / "sprint" / "record" — same pool, just patch in place.
      if (existing) updated = data.map((t) => (t.id === id ? { ...t, ...patch } : t));
    }

    if (updated) qc.setQueryData(key, updated);
  }
}

// NOTE: the old unconditional `invalidateTasks` is gone. An outright
// invalidation is unsafe now that writes can be queued: the refetch returns
// server rows that predate everything still in the outbox, so the user's
// offline edits vanish from the screen one query at a time. Mutations call
// `invalidateWhenSafe`, which refetches immediately when the table owes the
// server nothing and defers until the drain when it does.

/** Fields whose change requires re-syncing the Google mirror event. */
const MIRROR_FIELDS: (keyof Task)[] = ["start_time", "duration_minutes", "title", "status", "do_date"];

export interface NewTaskInput {
  title: string;
  notes?: string;
  do_date?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  deadline?: string | null;
  priority?: TaskPriority;
  labelIds?: string[];
  slot_id?: string | null;
  project_id?: string | null;
  initiative_id?: string | null;
  domain_id?: string | null;
  /** Internal: the optimistic temp id, so the wrapper can track this create's
   *  promise and defer any patch fired before the row is persisted. Stripped
   *  before the insert. */
  clientId?: string;
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const { recordUndo } = useOptionalUndoStack();

  // NOTE: the temp-id machinery this hook used to carry is gone. It existed
  // because the server minted the row id, so a patch fired in the ~150ms before
  // the insert round-tripped had no real id to address and had to be deferred
  // and re-targeted. Ids are now generated on the client (the outbox needs them
  // for idempotent replay anyway), so the id a task is created with is the id it
  // keeps — there is no window to race, online or off.

  /**
   * Create a task.
   *
   * The row is built in full on the client — id included — written to the
   * caches, and handed to the outbox. It does not wait for Postgres and it is
   * never rolled back: once `queueWrite` resolves the capture is in IndexedDB
   * and will land whenever the network next allows, including after a
   * force-quit. That is the entire point of the layer, and the reason a capture
   * typed in a tunnel is no longer a capture the user loses.
   */
  const createTask = async (input: NewTaskInput): Promise<Task> => {
    const id = input.clientId ?? crypto.randomUUID();
    const { labelIds, clientId: _clientId, ...fields } = input;
    const status: TaskStatus = input.do_date ? "planned" : "inbox";
    const duration =
      input.start_time != null
        ? (input.duration_minutes ?? DEFAULT_DURATION_MINUTES)
        : input.duration_minutes;

    const optimistic: Task = {
      id,
      user_id: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      title: input.title,
      notes: input.notes ?? "",
      status,
      do_date: input.do_date ?? null,
      start_time: input.start_time ?? null,
      duration_minutes: duration ?? null,
      deadline: input.deadline ?? null,
      priority: input.priority ?? "none",
      roll_count: 0,
      completed_at: null,
      project_id: input.project_id ?? null,
      initiative_id: input.initiative_id ?? null,
      domain_id: input.domain_id ?? null,
      key_result_id: null,
      sprint_id: null,
      big_rock_id: null,
      energy: null,
      assignee: "me",
      prework: "",
      prework_at: null,
      suggestion: null,
      suggested_at: null,
      google_event_id: null,
      sort_order: 9999,
      slot_id: input.slot_id ?? null,
      recurrence_id: null,
      recurrence_date: null,
      recurrence_overridden: false,
      task_labels: labelIds?.map((label_id) => ({ label_id })) ?? [],
    };

    qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
      old ? [...old, optimistic] : [optimistic],
    );

    await queueWrite(
      makeOp("tasks", "insert", id, {
        ...fields,
        duration_minutes: duration ?? null,
        status,
      }),
    );

    for (const label_id of labelIds ?? []) {
      await queueWrite(makeOp("task_labels", "insert", `${id}|${label_id}`, { }));
    }

    // The Google mirror is a server-side echo of a time block, not user data —
    // if we are offline it simply re-syncs after the drain, so there is nothing
    // to queue and nothing to lose by skipping it.
    if (optimistic.start_time && navigator.onLine) invokeQuiet("task-mirror", { taskId: id });

    invalidateWhenSafe(qc, "tasks", ["tasks"]);
    return optimistic;
  };

  const patchTask = (id: string, patch: Partial<Task>, opts?: UndoOpts & {
    /** When set, record a silent/toast undo that restores these fields. */
    before?: Partial<Task>;
    kind?: keyof typeof TASK_UNDO_DEFAULT;
    title?: string;
  }) => {
    // No temp-id dance: `id` is the real, client-minted primary key from the
    // moment the task exists, so a patch fired one tick after a create targets
    // the same row the insert will create. The outbox folds the two into a
    // single insert before either leaves the device.
    patchCaches(qc, id, patch);
    void queueWrite(makeOp("tasks", "update", id, patch as Record<string, unknown>));

    if (MIRROR_FIELDS.some((f) => f in patch) && navigator.onLine) {
      invokeQuiet("task-mirror", { taskId: id });
    }
    invalidateWhenSafe(qc, "tasks", ["tasks"]);

    // Field edits default to no undo (native input undo wins). Callers that
    // move/resize pass `before` + `undo` tier.
    if (opts?.before && opts.undo !== false) {
      const tier = opts.undo === "toast" || opts.undo === "silent"
        ? opts.undo
        : "silent";
      const before = opts.before;
      const kind = opts.kind;
      const title = opts.title ?? "";
      recordUndo({
        label: opts.label ?? (kind ? undoLabel(kind, title) : "Change"),
        shortLabel: kind ? undoShortLabel(kind) : "Change",
        batchLabel: kind ? (n) => undoLabel(kind, title, n) : undefined,
        batchShortLabel: kind ? (n) => undoShortLabel(kind, n) : undefined,
        tier,
        coalesceKey: opts.coalesceKey,
        undo: () => patchTask(id, before, { undo: false }),
      });
    }
  };

  const track = (
    kind: keyof typeof TASK_UNDO_DEFAULT,
    t: Task,
    before: Partial<Task>,
    apply: () => void,
    opts?: UndoOpts,
  ) => {
    const tier = resolveUndoTier(TASK_UNDO_DEFAULT[kind], opts);
    apply();
    if (tier === false) return;
    recordUndo({
      label: opts?.label ?? undoLabel(kind, t.title),
      shortLabel: undoShortLabel(kind),
      batchLabel: (n) => undoLabel(kind, t.title, n),
      batchShortLabel: (n) => undoShortLabel(kind, n),
      tier,
      coalesceKey: opts?.coalesceKey ?? (
        kind === "complete" || kind === "uncomplete" || kind === "trash"
          ? COALESCE[kind]
          : kind === "planFor" || kind === "backToInbox"
            ? COALESCE.plan
            : COALESCE.move
      ),
      undo: () => patchTask(t.id, before, { undo: false }),
    });
  };

  return {
    create: createTask,
    patchTask,

    /** Plan a task for a day without a time block (and out of any slot). */
    planFor: (t: Task, dateISO: string, opts?: UndoOpts) =>
      track("planFor", t, placeSnap(t), () =>
        patchTask(t.id, { status: "planned", do_date: dateISO, start_time: null, slot_id: null }, { undo: false }),
      opts),

    /** Block a task on the calendar at a concrete start (and out of any slot). */
    block: (t: Task, start: Date, durationMinutes?: number, opts?: UndoOpts) =>
      track("block", t, scheduleSnap(t), () =>
        patchTask(t.id, {
          status: "planned",
          do_date: todayLocalISO(start),
          start_time: start.toISOString(),
          slot_id: null,
          duration_minutes: durationMinutes ?? t.duration_minutes ?? DEFAULT_DURATION_MINUTES,
        }, { undo: false }),
      opts),

    /** Remove from calendar but keep planned for its day. */
    unblock: (t: Task, opts?: UndoOpts) =>
      track("unblock", t, placeSnap(t), () =>
        patchTask(t.id, { start_time: null }, { undo: false }),
      opts),

    /** Move a task into a slot: it drops its own block and rides the slot's day. */
    assignToSlot: (t: Task, slot: Slot, opts?: UndoOpts) =>
      track("assignToSlot", t, placeSnap(t), () =>
        patchTask(t.id, {
          slot_id: slot.id,
          start_time: null,
          do_date: slot.do_date,
          status: "planned",
        }, { undo: false }),
      opts),

    /** Pull a task out of its slot — keeps its day, still has no time block. */
    removeFromSlot: (t: Task, opts?: UndoOpts) =>
      track("removeFromSlot", t, placeSnap(t), () =>
        patchTask(t.id, { slot_id: null }, { undo: false }),
      opts),

    /** Create a fresh task already inside a slot (no block of its own). */
    createInSlot: (slot: Slot, title: string) =>
      createTask({
        title,
        do_date: slot.do_date,
        slot_id: slot.id,
        project_id: slot.project_id,
        domain_id: slot.domain_id,
      }),

    complete: (t: Task, opts?: UndoOpts) =>
      track("complete", t, completeSnap(t), () =>
        patchTask(t.id, { status: "done", completed_at: new Date().toISOString() }, { undo: false }),
      opts),

    uncomplete: (t: Task, opts?: UndoOpts) =>
      track("uncomplete", t, completeSnap(t), () =>
        patchTask(t.id, { status: restingStatus(t), completed_at: null }, { undo: false }),
      opts),

    trash: (t: Task, opts?: UndoOpts) =>
      track("trash", t, { status: t.status }, () =>
        patchTask(t.id, { status: "trashed" }, { undo: false }),
      opts),

    /** Release a task from its time. A task inside a PROJECT has a home and rests
     *  there — it must never land in the inbox, which is for captures with no home
     *  (forcing "inbox" here stranded project work in triage AND out of
     *  backlogTasks, which requires !inbox, so it nagged from the inbox about a
     *  project slotted to a different week entirely).
     *
     *  A domain tag is deliberately NOT a home: an SCE-tagged capture is still
     *  unsorted. Note restingStatus() disagrees — it counts domain/sprint as
     *  parented ("parked on a domain = someday"). That older model hasn't been
     *  reconciled, so don't swap this for restingStatus() without settling it. */
    backToInbox: (t: Task, opts?: UndoOpts) =>
      track("backToInbox", t, placeSnap(t), () =>
        patchTask(t.id, {
          status: t.project_id ? "backlog" : "inbox",
          do_date: null,
          start_time: null,
          slot_id: null,
        }, { undo: false }),
      opts),

    /** Reverse of backToInbox: file an inbox task back under its project/initiative/domain. */
    fileToProject: (t: Task, opts?: UndoOpts) =>
      track("fileToProject", t, { status: t.status }, () =>
        patchTask(t.id, { status: "backlog" }, { undo: false }),
      opts),

    /** An over-planned day degrades into the week pool, not into guilt-rolling:
     *  drop the date (and any slot), keep the sprint commitment. */
    backToWeek: (t: Task, opts?: UndoOpts) =>
      track("backToWeek", t, placeSnap(t), () =>
        patchTask(t.id, {
          status: restingStatus({ ...t, do_date: null }),
          do_date: null,
          start_time: null,
          slot_id: null,
        }, { undo: false }),
      opts),

    /**
     * Replace a task's labels.
     *
     * Expressed as a diff rather than the old delete-all-then-reinsert. That
     * pattern is not safe to replay: if the queue delivered the delete and then
     * lost the connection, the task came back with *no* labels — a destructive
     * intermediate state that a retry might never repair. Queuing only the rows
     * that actually changed means every op is independently idempotent and the
     * worst interruption leaves a partially-applied set, never an emptied one.
     */
    setLabels: async (taskId: string, labelIds: string[]) => {
      const current = new Set<string>();
      for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
        const hit = data?.find((t) => t.id === taskId);
        if (hit?.task_labels) {
          for (const l of hit.task_labels) current.add(l.label_id);
          break;
        }
      }
      const next = new Set(labelIds);

      patchCaches(qc, taskId, { task_labels: labelIds.map((label_id) => ({ label_id })) });

      for (const label_id of next) {
        if (!current.has(label_id)) {
          await queueWrite(makeOp("task_labels", "insert", `${taskId}|${label_id}`, {}));
        }
      }
      for (const label_id of current) {
        if (!next.has(label_id)) {
          await queueWrite(makeOp("task_labels", "delete", `${taskId}|${label_id}`));
        }
      }

      invalidateWhenSafe(qc, "tasks", ["tasks"]);
    },
  };
}

/** Local calendar date of an instant (the user lives in APP_TZ). */
function todayLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Passive inbox grooming. While the app is open, quietly ask the `enrichInbox`
 * edge path to guess a home / duration / energy for every capture that lacks a
 * fresh suggestion, so the inbox is already thought-about by the time the user
 * looks. All pending captures go out in ONE batched request (the edge function
 * fans them into at most two LLM completions) rather than one call per capture.
 * Server-side `sig` caching means each capture is groomed once until its text
 * changes, so this stays cheap across re-renders.
 */
export function useGroomInbox(inbox: Task[], enabled = true) {
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || running.current) return;
    // Skip optimistic rows (empty user_id) — they aren't persisted server-side yet.
    const pending = inbox.filter((t) => t.user_id && needsGrooming(t));
    if (!pending.length) return;

    running.current = true;
    let cancelled = false;
    (async () => {
      const { error } = await supabase.functions.invoke("agent", {
        body: { enrichInbox: { taskIds: pending.map((t) => t.id) } },
      });
      if (!error && !cancelled) qc.invalidateQueries({ queryKey: ["tasks", "inbox"] });
      running.current = false;
    })();

    return () => {
      cancelled = true;
      running.current = false;
    };
  }, [inbox, enabled, qc]);
}

/**
 * Defensive client-side rollover: if the cron missed (laptop asleep, etc.),
 * the first app open of a new day triggers the same edge function.
 */
export function useRolloverGuard(lastRolloverDate: string | null | undefined) {
  const qc = useQueryClient();
  const run = async () => {
    const today = todayISO();
    if (lastRolloverDate === today) return;
    const { error } = await supabase.functions.invoke("rollover", { body: {} });
    if (!error) {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    }
  };
  return run;
}
