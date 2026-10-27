import { CALENDAR_RANGE_STALE_MS } from "../lib/scheduleRange";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { holdFetchesBehindWrite, invalidateWhenSafe, makeOp, queueWrite, runWithoutOwingPreserve, settleWrite } from "../lib/sync";
import { DEFAULT_DURATION_MINUTES, type Slot, type Task } from "../lib/types";
import { toDateISO } from "../lib/dates";
import { patchCaches, seedSlotChildrenQuery, useTaskMutations } from "./useTasks";
import { useOptionalUndoStack } from "./useUndoStack";
import { useSettings } from "./useSettings";
import { useStableActions } from "./useStableActions";
// One rule for "how big is this block" (the kernel's, shared with the chat's
// `create_slot` — docs/planning-kernel.md §3), cut at midnight.
import { slotMinutesFor } from "../lib/slots";

const SLOT_COLS =
  "id, user_id, created_at, updated_at, title, do_date, start_time, duration_minutes, project_id, domain_id, color, google_event_id, recurrence_id, recurrence_date, recurrence_overridden";

/** Slots intersecting a calendar range (keyed on start, like scheduled tasks). */
export const slotsKey = (rangeStartISO: string, rangeEndISO: string) =>
  ["slots", rangeStartISO, rangeEndISO] as const;

/** Outside the hook so a range can be warmed before it is displayed — see
 *  `useCalendarRangePrefetch`. */
export async function fetchSlotsRange(rangeStartISO: string, rangeEndISO: string): Promise<Slot[]> {
  const { data, error } = await supabase
    .from("slots")
    .select(SLOT_COLS)
    .gte("start_time", rangeStartISO)
    .lt("start_time", rangeEndISO);
  if (error) throw error;
  return data as Slot[];
}

export function useSlots(rangeStartISO: string, rangeEndISO: string) {
  return useQuery({
    queryKey: slotsKey(rangeStartISO, rangeEndISO),
    // An empty bound is a caller saying "not yet" (a range that depends on
    // something still loading, or a feature that is switched off). Without this
    // it still went to the network as `start_time=gte.` — no value after the
    // dot — which PostgREST rejects with a 400 rather than an empty result.
    enabled: Boolean(rangeStartISO && rangeEndISO),
    queryFn: () => fetchSlotsRange(rangeStartISO, rangeEndISO),
    // Keep the previous range's slots on screen while a new range fetches —
    // without this the calendar goes empty for the whole round-trip.
    staleTime: CALENDAR_RANGE_STALE_MS,
    placeholderData: (prev) => prev,
  });
}

/** Keyed on the SORTED ids, so the same slots in a different order are one
 *  query — and so a warmed range lands on exactly the key the view asks for.
 *  Under ["tasks", …] so the realtime `tasks` invalidation refreshes it. */
export const slotTasksKey = (slotIds: string[]) => ["tasks", "slot", [...slotIds].sort()] as const;

export async function fetchSlotTasks(slotIds: string[]): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*, task_labels(label_id)")
    .in("slot_id", slotIds)
    .neq("status", "trashed")
    // Steps are not tasks — see NOT_A_STEP in useTasks.ts.
    .is("parent_task_id", null)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return data as Task[];
}

/** The tasks living inside a set of slots, ordered for in-slot display. */
export function useSlotTasks(slotIds: string[]) {
  return useQuery({
    queryKey: slotTasksKey(slotIds),
    enabled: slotIds.length > 0,
    queryFn: () => fetchSlotTasks(slotIds),
    // A newly created slot changes `ids` (a new key). Keep the previous
    // children painted while the seeded list / fetch takes over — without
    // this the block reads "empty" for the whole round-trip.
    staleTime: CALENDAR_RANGE_STALE_MS,
    placeholderData: (prev) => prev,
  });
}

export function patchSlotCaches(qc: QueryClient, id: string, patch: Partial<Slot>) {
  holdFetchesBehindWrite(qc, "slots", ["slots"]);
  runWithoutOwingPreserve(() => {
    qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
      old?.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  });
}

export function insertSlotCache(qc: QueryClient, slot: Slot) {
  holdFetchesBehindWrite(qc, "slots", ["slots"]);
  runWithoutOwingPreserve(() => {
    // Seed first: a slots-cache write notifies the Schedule, which remounts
    // useSlotTasks under the new id set. The children query has to exist
    // *before* that, or assignToSlot has nowhere to put them.
    seedSlotChildrenQuery(qc, slot.id);
    qc.setQueriesData<Slot[]>({ queryKey: ["slots"] }, (old) =>
      old ? [...old, slot] : [slot],
    );
  });
}

/** Place a slot's post-image into every mounted range query. `null` removes it. */
export function putSlotInCaches(qc: QueryClient, id: string, next: Slot | null) {
  runWithoutOwingPreserve(() => {
    for (const [key, data] of qc.getQueriesData<Slot[]>({ queryKey: ["slots"] })) {
      if (!Array.isArray(data)) continue;
      const rangeStart = key[1] as string | undefined;
      const rangeEnd = key[2] as string | undefined;
      const existing = data.find((s) => s.id === id);
      const belongs =
        next != null &&
        (!rangeStart || !rangeEnd ||
          (next.start_time >= rangeStart && next.start_time < rangeEnd));
      let updated: Slot[];
      if (!belongs) updated = data.filter((s) => s.id !== id);
      else if (existing) updated = data.map((s) => (s.id === id ? next! : s));
      else updated = [...data, next!];
      qc.setQueryData(key, updated);
    }
  });
}

export interface NewSlotInput {
  /** Only to bring a removed slot back as itself (undo of a merge) — a new
   *  slot always mints its own. */
  id?: string;
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
  const { settings } = useSettings();
  const defaultDurationMins = settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES;

  /**
   * Create a standing slot.
   *
   * Client-minted id, cache first, then the queue — same shape as a task
   * create, and for the same reason: the temp-id swap this used to do only
   * existed because Postgres named the row. A slot dragged onto the grid with
   * no network now stays there.
   */
  const createSlot = ({ id: givenId, ...input }: NewSlotInput): Slot => {
    const id = givenId ?? crypto.randomUUID();
    const optimistic: Slot = {
      id,
      user_id: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      title: input.title,
      do_date: input.do_date,
      start_time: input.start_time,
      duration_minutes: input.duration_minutes ?? defaultDurationMins,
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
          duration_minutes: input.duration_minutes ?? defaultDurationMins,
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
    // Every move and resize carries `do_date`, so this used to rewrite every
    // task list in the cache (a new array each, children or not) and then
    // refetch every task query — three or four full renders per slot drag. Only
    // the children whose day actually changes are touched now, and only lists
    // that hold one get a new array.
    const children = new Set<string>();
    if (patch.do_date !== undefined) {
      for (const [, rows] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
        for (const t of rows ?? []) if (t.slot_id === id && t.do_date !== patch.do_date) children.add(t.id);
      }
    }
    const paint = () => {
      patchSlotCaches(qc, id, patch);
      if (children.size) {
        holdFetchesBehindWrite(qc, "tasks", ["tasks"]);
        runWithoutOwingPreserve(() => {
          qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
            old?.some((t) => children.has(t.id))
              ? old.map((t) => (children.has(t.id) ? { ...t, do_date: patch.do_date! } : t))
              : old,
          );
        });
      }
    };
    paint();

    void (async () => {
      await queueWrite(makeOp("slots", "update", id, patch as Record<string, unknown>));

      if (children.size) {
        for (const taskId of children) {
          await queueWrite(makeOp("tasks", "update", taskId, { do_date: patch.do_date }));
        }
        // Realtime echoes these; only refetch when the channel isn't live.
        settleWrite(qc, "tasks", ["tasks"]);
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
    /**
     * A stated affinity, when the gesture already knows it: dragging a PROJECT
     * onto the grid means "this project's time", so the block is its sitting
     * even before any piece is inside it (a project whose work is all placed
     * elsewhere drops an empty sitting and then offers to gather it).
     */
    affinity?: { projectId?: string | null; domainId?: string | null; label?: string },
  ): Promise<Slot | null> => {
    if (tasks.length === 0 && !affinity?.projectId) return null;

    const only = <T,>(values: (T | null)[]): T | null => {
      const set = new Set(values);
      const first = [...set][0];
      return set.size === 1 && first != null ? first : null;
    };
    const projectId = affinity?.projectId ?? only(tasks.map((t) => t.project_id ?? null));
    const domainId =
      only(tasks.map((t) => domainOf(t))) ?? affinity?.domainId ?? null;

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
      // An empty sitting still has to be a real piece of time — the floor, not
      // a zero-height sliver you can't aim at.
      duration_minutes: slotMinutesFor(
        tasks.length > 0 ? tasks.map((t) => t.duration_minutes) : [DEFAULT_DURATION_MINUTES],
        start,
      ),
      project_id: projectId,
      domain_id: domainId,
    });

    tasks.forEach((t) => taskMutations.assignToSlot(t, slot, { undo: false }));

    const n = tasks.length;
    recordUndo({
      label: affinity?.label ?? `Blocked ${n} task${n === 1 ? "" : "s"} together`,
      shortLabel: affinity?.label ? "Placed the sitting" : "Blocked together",
      tier: "toast",
      undo: () => {
        before.forEach(({ id, ...snap }) => taskMutations.patchTask(id, snap, { undo: false }));
        removeSlot(slot);
      },
    });

    return slot;
  };

  /** Where each task was BEFORE anything moves — the same four fields every
   *  other place-act restores (D-063a). */
  const placeSnaps = (tasks: Task[]) =>
    tasks.map((t) => ({
      id: t.id,
      status: t.status,
      do_date: t.do_date,
      start_time: t.start_time,
      slot_id: t.slot_id,
    }));

  /**
   * **Gather work into a slot that already exists** — one act, one undo, and
   * optionally a move first.
   *
   * Two rules it must not break:
   *
   *  - **The slot grows to cover what it now holds** (`slotMinutesFor`), the
   *    same top-up-in-place rule a mid-week re-plan follows — a sitting that
   *    silently keeps its old 30 minutes while swallowing four tasks is the
   *    calendar lying about the week (D-084).
   *  - **It never shrinks.** You may have sized this block by hand; gathering is
   *    a reason to make room, never a reason to take it away.
   *
   * `to` moves the slot before it gathers — a slot dropped on a task goes to
   * the task's hour and takes it in (the block you drop on doesn't move).
   */
  const gather = (
    slot: Slot,
    tasks: Task[],
    alreadyHeld: Task[],
    undo: { label: string; shortLabel: string },
    to?: Date,
  ) => {
    if (tasks.length === 0 && !to) return;
    const before = placeSnaps(tasks);
    const was = {
      start_time: slot.start_time,
      do_date: slot.do_date,
      duration_minutes: slot.duration_minutes,
      recurrence_overridden: slot.recurrence_overridden,
    };
    const start = to ?? new Date(slot.start_time);
    const grown = slotMinutesFor(
      [...alreadyHeld, ...tasks].map((t) => t.duration_minutes),
      start,
      slot.duration_minutes,
    );
    const patch: Partial<Slot> = {
      ...(to
        ? {
            start_time: to.toISOString(),
            do_date: toDateISO(to),
            // A repeating slot's occurrence moved by hand keeps its new hour.
            ...(slot.recurrence_id ? { recurrence_overridden: true } : {}),
          }
        : {}),
      ...(grown !== slot.duration_minutes ? { duration_minutes: grown } : {}),
    };
    // Move first, so each child lands on the slot's new day.
    const moved: Slot = { ...slot, ...patch };
    if (Object.keys(patch).length) updateSlot({ id: slot.id, patch });
    tasks.forEach((t) => taskMutations.assignToSlot(t, moved, { undo: false }));

    recordUndo({
      ...undo,
      tier: "toast",
      undo: () => {
        before.forEach(({ id, ...snap }) => taskMutations.patchTask(id, snap, { undo: false }));
        if (Object.keys(patch).length) updateSlot({ id: slot.id, patch: was });
      },
    });
  };

  /** The reconcile half of placing a project by hand: work that already had a
   *  time is offered, never moved behind your back (P3) — this is the press. */
  const gatherIntoSlot = (slot: Slot, tasks: Task[], alreadyHeld: Task[] = []) => {
    const n = tasks.length;
    gather(slot, tasks, alreadyHeld, {
      label: `Moved ${n} piece${n === 1 ? "" : "s"} into the sitting`,
      shortLabel: "Moved in",
    });
  };

  /** A slot dropped on a task: it moves to the task's hour and takes it in. */
  const absorbIntoSlot = (slot: Slot, tasks: Task[], alreadyHeld: Task[], to: Date) =>
    gather(slot, tasks, alreadyHeld, { label: "Moved the slot and took the task in", shortLabel: "Slotted" }, to);

  /**
   * **Two slots become one** — `from`'s work joins `into`, and `from` goes.
   *
   * Never nesting: a slot holds tasks, not slots, and mirrors to the calendar
   * as ONE busy block — a slot inside a slot would be a second container and a
   * new noun (P10). `into` keeps everything that makes it itself — its name,
   * project, series — and grows to fit (never shrinks). The guards for what may
   * merge at all are `gatherActFor`'s.
   *
   * One undo brings `from` back as itself (same id) and puts each task back in it.
   */
  const mergeSlots = (into: Slot, intoChildren: Task[], from: Slot, fromChildren: Task[]) => {
    const moving = fromChildren.filter((t) => t.status !== "trashed");
    const before = placeSnaps(moving);
    const wasMins = into.duration_minutes;
    const grown = slotMinutesFor(
      [...intoChildren, ...moving].map((t) => t.duration_minutes),
      new Date(into.start_time),
      wasMins,
    );
    if (grown !== wasMins) updateSlot({ id: into.id, patch: { duration_minutes: grown } });
    moving.forEach((t) => taskMutations.assignToSlot(t, into, { undo: false }));
    removeSlot(from);

    const n = moving.length;
    recordUndo({
      label: `Merged ${n} task${n === 1 ? "" : "s"} into one slot`,
      shortLabel: "Merged",
      tier: "toast",
      undo: () => {
        // Back first, so the tasks have their own slot to return to.
        createSlot({
          id: from.id,
          title: from.title,
          do_date: from.do_date,
          start_time: from.start_time,
          duration_minutes: from.duration_minutes,
          project_id: from.project_id,
          domain_id: from.domain_id,
          color: from.color,
        });
        before.forEach(({ id, ...snap }) => taskMutations.patchTask(id, snap, { undo: false }));
        if (grown !== wasMins) updateSlot({ id: into.id, patch: { duration_minutes: wasMins } });
      },
    });
  };

  const removeSlot = (slot: Slot) => {
    putSlotInCaches(qc, slot.id, null);

    // Release the children *here*, not only on the server.
    //
    // `tasks.slot_id` is `on delete set null`, so Postgres does re-home them —
    // but only once the delete lands, and only visibly once something refetches.
    // Until then this device holds tasks pointing at a slot it has already
    // removed: they fail the slot query's membership test and are absent from
    // the day rail too, so deleting a sitting offline made everything inside it
    // disappear until the drain. Mirroring the cascade locally is what keeps
    // them on their day the whole time.
    const orphans = new Set<string>();
    for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
      if (!Array.isArray(data)) continue;
      for (const t of data) if (t.slot_id === slot.id) orphans.add(t.id);
    }
    for (const id of orphans) patchCaches(qc, id, { slot_id: null });

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

  return useStableActions({ createSlot, createSlotWith, gatherIntoSlot, absorbIntoSlot, mergeSlots, updateSlot, removeSlot });
}
