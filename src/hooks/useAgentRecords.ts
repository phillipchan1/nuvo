// useAgentRecords — read the records an agent action touched, LIVE, and reverse
// the action that touched them.
//
// The edge sends a pointer (`AgentAction.ref`), never the record's fields, so a
// card is a window onto the row rather than a receipt printed at reply time:
// reschedule the task on the Schedule and the card in the transcript follows.
// That only works if these lookups sit inside the caches everything else
// already writes to — hence the `["tasks"]` / `["external_events"]` prefixes,
// which `useRealtime` invalidates and `useTaskMutations` patches optimistically.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeQuiet, supabase } from "../lib/supabase";
import { invalidateWhenSafe, makeOp, queueWrite } from "../lib/sync";
import { patchCaches } from "./useTasks";
import { useVertical } from "./useVertical";
import type { AgentAction } from "../lib/agentTypes";
import type { ExternalEvent, Slot, Task } from "../lib/types";

const TASK_COLS = "*, task_labels(label_id)";

/** The row an agent action names, or undefined while it loads / if it's gone.
 *
 *  Data is an ARRAY, not a single row, on purpose: every optimistic writer in
 *  the app runs `setQueriesData<Task[]>({ queryKey: ["tasks"] }, old => old?.map(…))`
 *  over anything under that prefix. A bare object there would blow up on `.map`.
 *  Storing `[row]` means task edits made anywhere else land on this card for
 *  free — and stray rows an optimistic create appends are filtered by id below. */
export function useTaskRecord(id: string | undefined) {
  const { data } = useQuery({
    queryKey: ["tasks", "record", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase.from("tasks").select(TASK_COLS).eq("id", id!).limit(1);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });
  return data?.find((t) => t.id === id);
}

/** The block an action held or moved, live — same contract as useTaskRecord. */
export function useSlotRecord(id: string | undefined) {
  const { data } = useQuery({
    queryKey: ["slots", "record", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Slot[]> => {
      const { data, error } = await supabase
        .from("slots")
        .select("id, user_id, created_at, updated_at, title, do_date, start_time, duration_minutes, project_id, domain_id, color, google_event_id, recurrence_id, recurrence_date, recurrence_overridden")
        .eq("id", id!)
        .limit(1);
      if (error) throw error;
      return (data ?? []) as Slot[];
    },
  });
  return data?.find((s) => s.id === id);
}

export function useEventRecord(id: string | undefined) {
  const { data } = useQuery({
    queryKey: ["external_events", "record", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<ExternalEvent[]> => {
      const { data, error } = await supabase
        .from("external_events")
        .select("id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy, self_rsvp, recurring_event_id")
        .eq("id", id!)
        .limit(1);
      if (error) throw error;
      return (data ?? []) as ExternalEvent[];
    },
  });
  return data?.find((e) => e.id === id);
}

/** Reverse an action from its card. The edge already computed the inverse when
 *  it had the before-state in hand, so undo is one blind write — no re-deriving
 *  intent from the record's current shape, which may have moved on since. */
export function useAgentUndo() {
  const qc = useQueryClient();
  const { data: vertical, updateBigRock, addBigRocks, removeBigRock } = useVertical();

  const run = useMutation({
    mutationFn: async (action: AgentAction) => {
      const undo = action.undo;
      if (!undo) return;

      if (undo.kind === "task") {
        const id = action.ref?.id;
        if (!id) throw new Error("Nothing to undo — the action has no record.");
        patchCaches(qc, id, undo.patch as Partial<Task>);
        await queueWrite(makeOp("tasks", "update", id, undo.patch));
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
        return;
      }

      // A slot that moved goes back to where it was; the work inside travels
      // with it, exactly as it did on the way out. The children used to ride a
      // `.eq("slot_id", id)` predicate — resolved from the cache now and queued
      // per row, so an undo tapped offline restores the same set the user is
      // looking at rather than whatever occupies the slot when the queue drains.
      if (undo.kind === "slot") {
        const id = action.ref?.id;
        if (!id) throw new Error("Nothing to undo — the action has no record.");
        await queueWrite(makeOp("slots", "update", id, undo.patch));
        if (undo.patch.do_date) {
          for (const childId of taskIdsInSlot(qc, id)) {
            patchCaches(qc, childId, { do_date: undo.patch.do_date } as Partial<Task>);
            await queueWrite(makeOp("tasks", "update", childId, { do_date: undo.patch.do_date }));
          }
          invalidateWhenSafe(qc, "tasks", ["tasks"]);
        }
        if (navigator.onLine) invokeQuiet("slot-mirror", { slotId: id });
        invalidateWhenSafe(qc, "slots", ["slots"]);
        return;
      }

      // Undoing "hold this block" releases the time AND takes back the tasks it
      // created inside it — leaving them loose on the day would be a different
      // state than the one the user had before they asked. The child ids are
      // carried on the undo record, so this one never needed a predicate.
      if (undo.kind === "slot-delete") {
        for (const childId of undo.childIds) {
          patchCaches(qc, childId, { status: "trashed", slot_id: null } as Partial<Task>);
          await queueWrite(makeOp("tasks", "update", childId, { status: "trashed", slot_id: null }));
        }
        await queueWrite(makeOp("slots", "delete", undo.id));
        if (navigator.onLine) invokeQuiet("slot-mirror", { slotId: undo.id, deleted: true });
        invalidateWhenSafe(qc, "slots", ["slots"]);
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
        return;
      }

      // A priority is jsonb on the sprint row, so undo is a whole-rock swap:
      // restore = the rock as it was, or null to lift a created one back out.
      const { id, restore } = undo;
      if (!restore) {
        removeBigRock(id);
        return;
      }
      if (vertical.bigRocks.some((r) => r.id === id)) updateBigRock(id, restore);
      else addBigRocks([restore]);
    },
    onSuccess: () => {
      invalidateWhenSafe(qc, "tasks", ["tasks"]);
      invalidateWhenSafe(qc, "sprints", ["sprint"]);
      invalidateWhenSafe(qc, "slots", ["slots"]);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't undo that."),
  });

  return {
    undo: (action: AgentAction) => run.mutate(action),
    undoing: run.isPending,
  };
}

/** Task ids currently sitting in a slot, across every fragment of the task
 *  cache — the local answer to what `.eq("slot_id", id)` used to ask the server. */
function taskIdsInSlot(qc: QueryClient, slotId: string): string[] {
  const ids = new Set<string>();
  for (const [, rows] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
    for (const t of rows ?? []) if (t.slot_id === slotId) ids.add(t.id);
  }
  return [...ids];
}
