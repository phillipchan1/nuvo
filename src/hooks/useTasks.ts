import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { DEFAULT_DURATION_MINUTES, restingStatus, type Slot, type Task, type TaskPriority } from "../lib/types";
import { todayISO } from "../lib/dates";

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
  domain_id?: string | null;
}

export function useTaskMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (input: NewTaskInput): Promise<Task> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not signed in");
      const { labelIds, ...fields } = input;
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
      patchCaches(qc, id, patch);
    },
    onSuccess: ({ id, patch }) => {
      if (MIRROR_FIELDS.some((f) => f in patch)) invokeQuiet("task-mirror", { taskId: id });
    },
    onSettled: () => invalidateTasks(qc),
  });

  const patchTask = (id: string, patch: Partial<Task>) => update.mutate({ id, patch });

  return {
    create: create.mutateAsync,
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
      create.mutateAsync({
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

    backToInbox: (t: Task) =>
      patchTask(t.id, { status: "inbox", do_date: null, start_time: null }),

    /** An over-planned day degrades into the week pool, not into guilt-rolling:
     *  drop the date, keep the sprint commitment. */
    backToWeek: (t: Task) =>
      patchTask(t.id, {
        status: restingStatus({ ...t, do_date: null }),
        do_date: null,
        start_time: null,
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
