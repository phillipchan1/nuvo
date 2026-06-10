import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { DEFAULT_DURATION_MINUTES, type Task, type TaskPriority } from "../lib/types";
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
}

export function useTaskMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (input: NewTaskInput): Promise<Task> => {
      const { data: u } = await supabase.auth.getUser();
      const { labelIds, ...fields } = input;
      const status = fields.do_date ? "planned" : "inbox";
      const duration =
        fields.start_time != null
          ? (fields.duration_minutes ?? DEFAULT_DURATION_MINUTES)
          : fields.duration_minutes;
      const { data, error } = await supabase
        .from("tasks")
        .insert({ ...fields, duration_minutes: duration, status, user_id: u.user!.id })
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

    /** Plan a task for a day without a time block. */
    planFor: (t: Task, dateISO: string) =>
      patchTask(t.id, { status: "planned", do_date: dateISO, start_time: null }),

    /** Block a task on the calendar at a concrete start. */
    block: (t: Task, start: Date, durationMinutes?: number) =>
      patchTask(t.id, {
        status: "planned",
        do_date: todayLocalISO(start),
        start_time: start.toISOString(),
        duration_minutes: durationMinutes ?? t.duration_minutes ?? DEFAULT_DURATION_MINUTES,
      }),

    /** Remove from calendar but keep planned for its day. */
    unblock: (t: Task) => patchTask(t.id, { start_time: null }),

    complete: (t: Task) =>
      patchTask(t.id, { status: "done", completed_at: new Date().toISOString() }),

    uncomplete: (t: Task) => patchTask(t.id, { status: t.do_date ? "planned" : "inbox", completed_at: null }),

    trash: (t: Task) => patchTask(t.id, { status: "trashed" }),

    backToInbox: (t: Task) =>
      patchTask(t.id, { status: "inbox", do_date: null, start_time: null }),

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
