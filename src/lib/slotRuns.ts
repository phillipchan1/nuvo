// The day's clock, with each slot kept whole.
//
// The rail's "On the clock" list is a flat run of rows ordered by when they
// start. A slot's tasks carry the SLOT's start time (the DB leaves theirs null —
// the slot holds the time, the task doesn't), so five tasks in one 8–10am slot
// rendered as five unrelated rows with the same hidden time, indistinguishable
// from five separate commitments. On the phone it was worse: slot children are
// excluded from the day query entirely ("they show inside their slot"), and the
// Tasks screen had no slot to show them inside — they simply weren't on Today.
//
// This is the one read both shells draw from: a slot becomes a single entry that
// owns its open tasks, standing at its own start time among the lone timed
// tasks. A slot with nothing open still gets an entry — an empty slot is held
// time with nothing in it, which is a fact the list should be able to say, and a
// slot whose work is all done should read "done", not vanish. (Never re-derive
// this in a surface — D-178.)

import type { Slot, Task } from "./types";

export interface SlotRun {
  kind: "slot";
  slot: Slot;
  /** Its open tasks, in the slot's own hand order. */
  open: Task[];
  /** Tasks in this slot already done today (they live in the Done tail). */
  doneCount: number;
  /** Minutes of work the open tasks ask for (unestimated ones count as 0). */
  askMinutes: number;
}

export interface LoneTask {
  kind: "task";
  task: Task;
}

export type ClockEntry = SlotRun | LoneTask;

/** What a slot header says it holds — a fact, not a nudge (P4). */
export type SlotState = "empty" | "open" | "done";

export function slotState(run: Pick<SlotRun, "open" | "doneCount">): SlotState {
  if (run.open.length > 0) return "open";
  return run.doneCount > 0 ? "done" : "empty";
}

/**
 * @param scheduled today's open timed rows — lone tasks AND slot children (the
 *                  latter already stamped with their slot's start, as the rail
 *                  builds them)
 * @param slots     today's slots
 * @param done      today's done rows, only used to say how much of a slot landed
 */
export function clockEntries(scheduled: readonly Task[], slots: readonly Slot[], done: readonly Task[] = []): ClockEntry[] {
  const byId = new Map(slots.map((s) => [s.id, s]));
  const runs = new Map<string, SlotRun>();
  for (const s of slots) runs.set(s.id, { kind: "slot", slot: s, open: [], doneCount: 0, askMinutes: 0 });

  const lone: LoneTask[] = [];
  for (const t of scheduled) {
    const run = t.slot_id ? runs.get(t.slot_id) : undefined;
    if (run && t.slot_id && byId.has(t.slot_id)) {
      run.open.push(t);
      run.askMinutes += t.duration_minutes ?? 0;
    } else {
      lone.push({ kind: "task", task: t });
    }
  }
  for (const t of done) {
    const run = t.slot_id ? runs.get(t.slot_id) : undefined;
    if (run) run.doneCount += 1;
  }
  for (const run of runs.values()) run.open.sort((a, b) => a.sort_order - b.sort_order);

  const startOf = (e: ClockEntry) => (e.kind === "slot" ? e.slot.start_time : (e.task.start_time ?? ""));
  return [...runs.values(), ...lone].sort(
    (a, b) =>
      startOf(a).localeCompare(startOf(b)) ||
      // At the same minute the slot stands first: it is the container, and the
      // lone task beside it is not inside it.
      (a.kind === b.kind ? 0 : a.kind === "slot" ? -1 : 1),
  );
}

/** Every open task id the clock lists, flattened in draw order — the order a
 *  ⇧-click range and the j / k keys walk. */
export function clockTaskIds(entries: readonly ClockEntry[]): string[] {
  return entries.flatMap((e) => (e.kind === "slot" ? e.open.map((t) => t.id) : [e.task.id]));
}

/**
 * Today's tasks as a LIST draws them: the day's own rows plus every task that is
 * inside one of today's slots, each stamped with its slot's start (the DB leaves a
 * slot child's own `start_time` null — the slot carries the time). The day query
 * deliberately excludes slot children ("they show inside their slot"), so a
 * surface that only had the day query — the whole phone — never showed them.
 *
 * Deduped by id, preferring the slot-stamped copy: an optimistic `assignToSlot`
 * used to leave the day-query row in place (slot_id already stamped) AND add it
 * through the slot's children, so one task rendered twice.
 *
 * @param resolve the freshest copy of a row by id (the caller's merged cache);
 *                a row it can't find is skipped, as it always was.
 */
export function todayWithSlotChildren(args: {
  dayRows: readonly Task[];
  slotChildren: readonly Task[];
  slots: readonly Slot[];
  today: string;
  resolve: (t: Task) => Task | undefined;
}): Task[] {
  const { dayRows, slotChildren, slots, today, resolve } = args;
  const todaySlots = new Map(slots.filter((s) => s.do_date === today).map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const raw of slotChildren) {
    if (!raw.slot_id || !todaySlots.has(raw.slot_id) || raw.status === "trashed") continue;
    if (seen.has(raw.id)) continue;
    const t = resolve(raw);
    if (!t || t.status === "trashed") continue;
    seen.add(raw.id);
    out.push({ ...t, start_time: todaySlots.get(raw.slot_id)!.start_time });
  }
  for (const raw of dayRows) {
    if (raw.slot_id || seen.has(raw.id) || raw.status === "trashed") continue;
    const t = resolve(raw);
    if (!t || t.status === "trashed") continue;
    seen.add(raw.id);
    out.push(t);
  }
  return out;
}
