import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { DEFAULT_DURATION_MINUTES, type Slot, type Task } from "../lib/types";

const SLOT_COLS =
  "id, user_id, created_at, updated_at, title, do_date, start_time, duration_minutes, project_id, domain_id, color, google_event_id, recurrence_id, recurrence_date, recurrence_overridden";

/** Slots intersecting a calendar range (keyed on start, like scheduled tasks). */
export function useSlots(rangeStartISO: string, rangeEndISO: string) {
  return useQuery({
    queryKey: ["slots", rangeStartISO, rangeEndISO],
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
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });
}

function patchSlotCaches(qc: QueryClient, id: string, patch: Partial<Slot>) {
  qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
    old?.map((s) => (s.id === id ? { ...s, ...patch } : s)),
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

  const create = useMutation({
    mutationFn: async (input: NewSlotInput): Promise<Slot> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("slots")
        .insert({
          ...input,
          duration_minutes: input.duration_minutes ?? DEFAULT_DURATION_MINUTES,
          user_id: session.user.id,
        })
        .select(SLOT_COLS)
        .single();
      if (error) throw error;
      invokeQuiet("slot-mirror", { slotId: data.id });
      return data as Slot;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["slots"] });
      const tempId = crypto.randomUUID();
      const optimistic: Slot = {
        id: tempId,
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
      qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      return { tempId };
    },
    onSuccess: (realSlot, _, ctx) => {
      if (!ctx) return;
      qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
        old?.map((s) => (s.id === ctx.tempId ? realSlot : s)),
      );
    },
    onError: (_, __, ctx) => {
      if (!ctx) return;
      qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
        old?.filter((s) => s.id !== ctx.tempId),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["slots"] }),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Slot> }) => {
      const { error } = await supabase.from("slots").update(patch).eq("id", id);
      if (error) throw error;
      // Children ride the slot's day — keep their do_date in lockstep so the
      // week board / readiness don't treat slotted work as "needs a day".
      // Fire-and-forget: the UI already moved them in onMutate, and awaiting
      // this (plus the Google mirror) was blanking the calendar for seconds.
      if (patch.do_date !== undefined) {
        void supabase
          .from("tasks")
          .update({ do_date: patch.do_date })
          .eq("slot_id", id)
          .then(({ error: childErr }) => {
            if (childErr) console.warn("[nuvo] slot child do_date sync failed:", childErr.message);
          });
      }
      return { id, patch };
    },
    onMutate: async ({ id, patch }) => {
      // Paint FIRST — any await before the cache write leaves FullCalendar
      // reconciling against stale props, and the event vanishes until a slow
      // refetch lands. Snapshot for rollback, then cancel in-flight refetches
      // so they can't overwrite the optimistic times, then re-apply.
      const snapshot = qc.getQueriesData<Slot[]>({ queryKey: ["slots"] });
      const taskSnapshot = qc.getQueriesData<Task[]>({ queryKey: ["tasks"] });
      const paint = () => {
        patchSlotCaches(qc, id, patch);
        if (patch.do_date !== undefined) {
          qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
            old?.map((t) => (t.slot_id === id ? { ...t, do_date: patch.do_date! } : t)),
          );
        }
      };
      paint();
      await Promise.all([
        qc.cancelQueries({ queryKey: ["slots"] }),
        qc.cancelQueries({ queryKey: ["tasks"] }),
      ]);
      paint();
      return { snapshot, taskSnapshot };
    },
    onSuccess: ({ id }) => invokeQuiet("slot-mirror", { slotId: id }),
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      if (ctx?.taskSnapshot) {
        for (const [key, data] of ctx.taskSnapshot) qc.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, vars) => {
      // Do NOT invalidate slots here. The optimistic patch is the truth the
      // user just dragged to; a refetch (often multi-second to Supabase, and
      // echoed again by realtime from our own write) was clearing the event
      // off the grid until it returned. Realtime still refreshes google_event_id
      // / cross-tab edits. Tasks only when the day actually moved.
      if (vars.patch.do_date !== undefined) {
        qc.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
  });

  const remove = useMutation({
    mutationFn: async (slot: Slot) => {
      // Tear down the Google mirror first, passing the event id directly since
      // the row is about to vanish (slot-mirror can't read a deleted row).
      invokeQuiet("slot-mirror", {
        slotId: slot.id,
        deleted: true,
        googleEventId: slot.google_event_id,
      });
      const { error } = await supabase.from("slots").delete().eq("id", slot.id);
      if (error) throw error;
    },
    onMutate: async (slot) => {
      const snapshot = qc.getQueriesData<Slot[]>({ queryKey: ["slots"] });
      qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
        old?.filter((s) => s.id !== slot.id),
      );
      await qc.cancelQueries({ queryKey: ["slots"] });
      qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
        old?.filter((s) => s.id !== slot.id),
      );
      return { snapshot };
    },
    onError: (_err, _slot, ctx) => {
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["slots"] });
      qc.invalidateQueries({ queryKey: ["tasks"] }); // orphaned children
    },
  });

  return {
    createSlot: create.mutateAsync,
    updateSlot: update.mutate,
    removeSlot: remove.mutate,
  };
}
