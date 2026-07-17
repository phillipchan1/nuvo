import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { DEFAULT_DURATION_MINUTES, restingStatus, type Slot, type Task, type TaskPriority, type TaskStatus } from "../lib/types";
import { todayISO } from "../lib/dates";
import { needsGrooming } from "../lib/grooming";

const TASK_COLS = "*, task_labels(label_id)";

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

/** Patch a task in every cached task list (optimistic update). */
function patchCaches(qc: QueryClient, id: string, patch: Partial<Task>) {
  qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
    old?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  );
}

function invalidateTasks(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["tasks"] });
}

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

  // In-flight creates keyed by their optimistic temp id. A task can be toggled
  // (or otherwise patched) within the ~150ms before its insert round-trips —
  // patching the temp id is a server no-op and gets clobbered when the create
  // resolves, so the change appears to "stick then revert". We defer such
  // patches until the real row exists, then apply them to its real id.
  const pendingCreates = useRef(new Map<string, Promise<Task>>());

  const create = useMutation({
    mutationFn: async (input: NewTaskInput): Promise<Task> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not signed in");
      const { labelIds, clientId: _clientId, ...fields } = input;
      const status = fields.do_date ? "planned" : "inbox";
      const duration =
        fields.start_time != null
          ? (fields.duration_minutes ?? DEFAULT_DURATION_MINUTES)
          : fields.duration_minutes;
      const { data, error } = await supabase
        .from("tasks")
        .insert({ ...fields, duration_minutes: duration, status, user_id: session.user.id })
        .select(TASK_COLS)
        .single();
      if (error) throw error;
      if (labelIds?.length) {
        await supabase
          .from("task_labels")
          .insert(labelIds.map((label_id) => ({ task_id: data.id, label_id })));
      }
      if (data.start_time) invokeQuiet("task-mirror", { taskId: data.id });
      return data as Task;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const tempId = input.clientId ?? crypto.randomUUID();
      const status: TaskStatus = input.do_date ? "planned" : "inbox";
      const duration = input.start_time != null
        ? (input.duration_minutes ?? DEFAULT_DURATION_MINUTES)
        : input.duration_minutes;
      const optimistic: Task = {
        id: tempId,
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
        task_labels: input.labelIds?.map((label_id) => ({ label_id })) ?? [],
      };
      qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      return { tempId };
    },
    onSuccess: (realTask, _, ctx) => {
      if (!ctx) return;
      qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        old?.map((t) => (t.id === ctx.tempId ? realTask : t)),
      );
    },
    onError: (_, __, ctx) => {
      if (!ctx) return;
      qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        old?.filter((t) => t.id !== ctx.tempId),
      );
    },
    onSettled: () => invalidateTasks(qc),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Task> }) => {
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw error;
      return { id, patch };
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snapshot = qc.getQueriesData<Task[]>({ queryKey: ["tasks"] });
      patchCaches(qc, id, patch);
      return { snapshot };
    },
    onSuccess: ({ id, patch }) => {
      if (MIRROR_FIELDS.some((f) => f in patch)) invokeQuiet("task-mirror", { taskId: id });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
    },
    onSettled: () => invalidateTasks(qc),
  });

  /** Create a task, tracking its in-flight promise so patches fired before the
   *  insert resolves can be re-targeted at the real row (see `pendingCreates`). */
  const createTask = (input: NewTaskInput): Promise<Task> => {
    const clientId = crypto.randomUUID();
    const promise = create.mutateAsync({ ...input, clientId });
    pendingCreates.current.set(clientId, promise);
    void promise
      .catch(() => {}) // the create's own onError unwinds the optimistic row
      .finally(() => pendingCreates.current.delete(clientId));
    return promise;
  };

  const patchTask = (id: string, patch: Partial<Task>) => {
    const pending = pendingCreates.current.get(id);
    if (pending) {
      // Show the change immediately on the optimistic row, but defer the server
      // write until the insert resolves — then patch the real id so it sticks.
      patchCaches(qc, id, patch);
      void pending.then((real) => update.mutate({ id: real.id, patch })).catch(() => {});
      return;
    }
    update.mutate({ id, patch });
  };

  return {
    create: createTask,
    patchTask,

    /** Plan a task for a day without a time block (and out of any slot). */
    planFor: (t: Task, dateISO: string) =>
      patchTask(t.id, { status: "planned", do_date: dateISO, start_time: null, slot_id: null }),

    /** Block a task on the calendar at a concrete start (and out of any slot). */
    block: (t: Task, start: Date, durationMinutes?: number) =>
      patchTask(t.id, {
        status: "planned",
        do_date: todayLocalISO(start),
        start_time: start.toISOString(),
        slot_id: null,
        duration_minutes: durationMinutes ?? t.duration_minutes ?? DEFAULT_DURATION_MINUTES,
      }),

    /** Remove from calendar but keep planned for its day. */
    unblock: (t: Task) => patchTask(t.id, { start_time: null }),

    /** Move a task into a slot: it drops its own block and rides the slot's day. */
    assignToSlot: (t: Task, slot: Slot) =>
      patchTask(t.id, {
        slot_id: slot.id,
        start_time: null,
        do_date: slot.do_date,
        status: "planned",
      }),

    /** Pull a task out of its slot — keeps its day, still has no time block. */
    removeFromSlot: (t: Task) => patchTask(t.id, { slot_id: null }),

    /** Create a fresh task already inside a slot (no block of its own). */
    createInSlot: (slot: Slot, title: string) =>
      createTask({
        title,
        do_date: slot.do_date,
        slot_id: slot.id,
        project_id: slot.project_id,
        domain_id: slot.domain_id,
      }),

    complete: (t: Task) =>
      patchTask(t.id, { status: "done", completed_at: new Date().toISOString() }),

    uncomplete: (t: Task) => patchTask(t.id, { status: restingStatus(t), completed_at: null }),

    trash: (t: Task) => patchTask(t.id, { status: "trashed" }),

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
    backToInbox: (t: Task) =>
      patchTask(t.id, {
        status: t.project_id ? "backlog" : "inbox",
        do_date: null,
        start_time: null,
        slot_id: null,
      }),

    /** Reverse of backToInbox: file an inbox task back under its project/initiative/domain. */
    fileToProject: (t: Task) => patchTask(t.id, { status: "backlog" }),

    /** An over-planned day degrades into the week pool, not into guilt-rolling:
     *  drop the date (and any slot), keep the sprint commitment. */
    backToWeek: (t: Task) =>
      patchTask(t.id, {
        status: restingStatus({ ...t, do_date: null }),
        do_date: null,
        start_time: null,
        slot_id: null,
      }),

    setLabels: async (taskId: string, labelIds: string[]) => {
      await supabase.from("task_labels").delete().eq("task_id", taskId);
      if (labelIds.length) {
        await supabase
          .from("task_labels")
          .insert(labelIds.map((label_id) => ({ task_id: taskId, label_id })));
      }
      invalidateTasks(qc);
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
