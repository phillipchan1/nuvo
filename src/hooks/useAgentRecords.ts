// useAgentRecords — read the records an agent action touched, LIVE, and reverse
// the action that touched them.
//
// The edge sends a pointer (`AgentAction.ref`), never the record's fields, so a
// card is a window onto the row rather than a receipt printed at reply time:
// reschedule the task on the Schedule and the card in the transcript follows.
// That only works if these lookups sit inside the caches everything else
// already writes to — hence the `["tasks"]` / `["external_events"]` prefixes,
// which `useRealtime` invalidates and `useTaskMutations` patches optimistically.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useVertical } from "./useVertical";
import type { AgentAction } from "../lib/agentTypes";
import type { ExternalEvent, Task } from "../lib/types";

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
        const { error } = await supabase.from("tasks").update(undo.patch).eq("id", id);
        if (error) throw error;
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
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["sprint"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't undo that."),
  });

  return {
    undo: (action: AgentAction) => run.mutate(action),
    undoing: run.isPending,
  };
}
