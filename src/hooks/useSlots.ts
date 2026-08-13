import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";
import { DEFAULT_DURATION_MINUTES, type Slot, type Task } from "../lib/types";
import { toDateISO } from "../lib/dates";
import { useTaskMutations } from "./useTasks";
import { useOptionalUndoStack } from "./useUndoStack";
// One rule for "how big is this block", shared with the chat's `create_slot` —
// see docs/planning-kernel.md §3.
import { sizeSlotToContents } from "../../supabase/functions/_shared/slotSizing.ts";

const SLOT_COLS =
  "id, user_id, created_at, updated_at, title, do_date, start_time, duration_minutes, project_id, domain_id, color, google_event_id, recurrence_id, recurrence_date, recurrence_overridden";

/** Slots intersecting a calendar range (keyed on start, like scheduled tasks). */
export function useSlots(rangeStartISO: string, rangeEndISO: string) {
  return useQuery({
    queryKey: ["slots", rangeStartISO, rangeEndISO],
    // An empty bound is a caller saying "not yet" (a range that depends on
    // something still loading, or a feature that is switched off). Without this
    // it still went to the network as `start_time=gte.` — no value after the
    // dot — which PostgREST rejects with a 400 rather than an empty result.
    enabled: Boolean(rangeStartISO && rangeEndISO),
    queryFn: async (): Promise<Slot[]> => {
      const { data, error } = await supabase
        .from("slots")
        .select(SLOT_COLS)
        .gte("start_time", rangeStartISO)
        .lt("start_time", rangeEndISO);
      if (error) throw error;
      return data as Slot[];
    },
    // Keep the previous range's slots on screen while a new range fetches —
    // without this the calendar goes empty for the whole round-trip.
    placeholderData: (prev) => prev,
  });
}

/** The tasks living inside a set of slots, ordered for in-slot display.
 *  Keyed under ["tasks", …] so the realtime `tasks` invalidation refreshes it. */
export function useSlotTasks(slotIds: string[]) {
  const ids = [...slotIds].sort();
  return useQuery({
    queryKey: ["tasks", "slot", ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, task_labels(label_id)")
        .in("slot_id", ids)
        .neq("status", "trashed")
        // Steps are not tasks — see NOT_A_STEP in useTasks.ts.
        .is("parent_task_id", null)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });
}

export function patchSlotCaches(qc: QueryClient, id: string, patch: Partial<Slot>) {
  qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
    old?.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  );
}

export function insertSlotCache(qc: QueryClient, slot: Slot) {
  qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
    old ? [...old, slot] : [slot],
  );
}

export interface NewSlotInput {
  title: string;
  do_date: string;
  start_time: string;
  duration_minutes?: number;
  project_id?: string | null;
  domain_id?: string | null;
  color?: string | null;
}

export function useSlotMutations() {
  const qc = useQueryClient();
  const taskMutations = useTaskMutations();
  const { recordUndo } = useOptionalUndoStack();

  /**
   * Create a standing slot.
   *
   * Client-minted id, cache first, then the queue — same shape as a task
   * create, and for the same reason: the temp-id swap this used to do only
   * existed because Postgres named the row. A slot dragged onto the grid with
   * no network now stays there.
   */
  const createSlot = (input: NewSlotInput): Slot => {
    const id = crypto.randomUUID();
    const optimistic: Slot = {
      id,
      user_id: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      title: input.title,
      do_date: input.do_date,
      start_time: input.start_time,
      duration_minutes: input.duration_minutes ?? DEFAULT_DURATION_MINUTES,
      project_id: input.project_id ?? null,
      domain_id: input.domain_id ?? null,
      color: input.color ?? null,
      google_event_id: null,
      recurrence_id: null,
      recurrence_date: null,
      recurrence_overridden: false,
    };
    insertSlotCache(qc, optimistic);

    void (async () => {
      await queueWrite(
        makeOp("slots", "insert", id, {
          ...input,
          duration_minutes: input.duration_minutes ?? DEFAULT_DURATION_MINUTES,
        }),
      );
      if (navigator.onLine) invokeQuiet("slot-mirror", { slotId: id });
      invalidateWhenSafe(qc, "slots", ["slots"]);
    })();
    return optimistic;
  };

  /**
   * Move / resize a slot, dragging its children's day with it.
   *
   * The child sync was `.update({do_date}).eq("slot_id", id)` — a predicate the
   * server resolves. Queued, that is unsafe (it would match whatever sits in the
   * slot days later, not what the user moved), so the children are resolved from
   * the task cache now and queued one op each.
   *
   * Slots deliberately still do NOT invalidate on settle: the optimistic patch
   * is what the user dragged to, and a refetch used to clear the event off the
   * grid until it returned.
   */
  const updateSlot = ({ id, patch }: { id: string; patch: Partial<Slot> }) => {
    const paint = () => {
      patchSlotCaches(qc, id, patch);
      if (patch.do_date !== undefined) {
        qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
          old?.map((t) => (t.slot_id === id ? { ...t, do_date: patch.do_date! } : t)),
        );
      }
    };
    paint();

    void (async () => {
      await queueWrite(makeOp("slots", "update", id, patch as Record<string, unknown>));

      if (patch.do_date !== undefined) {
        const children = new Set<string>();
        for (const [, rows] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
          for (const t of rows ?? []) if (t.slot_id === id) children.add(t.id);
        }
        for (const taskId of children) {
          await queueWrite(makeOp("tasks", "update", taskId, { do_date: patch.do_date }));
        }
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
      }
      if (navigator.onLine) invokeQuiet("slot-mirror", { slotId: id });
    })();
  };

  /**
   * Several pieces of work + a time → **one block that holds them all.**
   *
   * The Schedule's twin of the chat's `create_slot` (D-066). Dropping four
   * selected rows on the grid used to tile four anonymous back-to-back blocks
   * across the morning — four answers to one question. It is one block now.
   *
   * Three things this deliberately does:
   *  - **Sizes to the contents**, through the shared kernel rule, so the block
   *    the browser makes and the block the chat makes are the same size.
   *  - **Leaves `title` blank**, so it stays *derived* (`deriveSlotTitle`) and
   *    wears the existing "auto-named — type to override" affordance. A block
   *    is never nameless, with no network and no AI involved.
   *  - **Takes the affinity the contents agree on** — one project, or failing
   *    that one domain (via `taskDomainId`, never the stale `domain_id` copy —
   *    D-088) — which is what makes the derived name good and keeps the hours
   *    attributed to the right domain.
   *
   * The whole gesture is ONE undo entry: four undo steps for one drag is a bug.
   */
  const createSlotWith = async (
    tasks: Task[],
    start: Date,
    /** Where a task's hours actually count — pass `taskDomainId(vertical, t)`. */
    domainOf: (t: Task) => string | null,
  ): Promise<Slot | null> => {
    if (tasks.length === 0) return null;

    const only = <T,>(values: (T | null)[]): T | null => {
      const set = new Set(values);
      const first = [...set][0];
      return set.size === 1 && first != null ? first : null;
    };
    const projectId = only(tasks.map((t) => t.project_id ?? null));
    const domainId = only(tasks.map((t) => domainOf(t)));

    // Snapshot where each task was BEFORE anything moves — the same four
    // fields every other place-act restores (D-063a).
    const before = tasks.map((t) => ({
      id: t.id,
      status: t.status,
      do_date: t.do_date,
      start_time: t.start_time,
      slot_id: t.slot_id,
    }));

    const slot = createSlot({
      title: "",
      do_date: toDateISO(start),
      start_time: start.toISOString(),
      duration_minutes: sizeSlotToContents(tasks.map((t) => t.duration_minutes)),
      project_id: projectId,
      domain_id: domainId,
    });

    tasks.forEach((t) => taskMutations.assignToSlot(t, slot, { undo: false }));

    const n = tasks.length;
    recordUndo({
      label: `Blocked ${n} task${n === 1 ? "" : "s"} together`,
      shortLabel: "Blocked together",
      tier: "toast",
      undo: () => {
        before.forEach(({ id, ...snap }) => taskMutations.patchTask(id, snap, { undo: false }));
        removeSlot(slot);
      },
    });

    return slot;
  };

  const removeSlot = (slot: Slot) => {
    qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
      old?.filter((s) => s.id !== slot.id),
    );
    // The mirror teardown carries the event id directly — the row is about to
    // go, and slot-mirror cannot read a deleted row.
    if (navigator.onLine) {
      invokeQuiet("slot-mirror", {
        slotId: slot.id,
        deleted: true,
        googleEventId: slot.google_event_id,
      });
    }
    void queueWrite(makeOp("slots", "delete", slot.id));
    invalidateWhenSafe(qc, "slots", ["slots"]);
    invalidateWhenSafe(qc, "tasks", ["tasks"]); // orphaned children
  };

  return { createSlot, createSlotWith, updateSlot, removeSlot };
}
