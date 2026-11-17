// Focus (D-242) — the one block you are in, and nothing else.
//
// The rail answers "what's on today" with every row the day holds; inside a
// block that is the wrong question. Focus narrows the rail to ONE sitting — a
// block on the calendar (a slot, or a lone timed task), or a few tasks you
// picked by hand — and closes it with the finish ring when the last one is
// done. This file is the whole rule: what a focus holds, what it says, and
// what ⌘. picks when you haven't said. Surfaces draw it; they never re-decide
// it.
//
// A focus is a VIEW, not a thing: nothing here is written to the database. It
// lives for the day it was started on (lib/focusStore), so a stale one from
// yesterday never opens on this morning's rail.

import type { Slot, Task } from "./types";
import type { BusyBlock } from "./now";
import { endOf } from "./dates";

/** What you are focused on. A slot and a lone timed task are blocks on the
 *  calendar; `set` is a few tasks you picked, wherever they live. */
export type FocusTarget =
  | { kind: "slot"; slotId: string }
  | { kind: "task"; taskId: string }
  | { kind: "set"; taskIds: string[] };

/** One block you could focus on — the picker's row and ⌘.'s answer. */
export interface FocusBlock {
  target: FocusTarget;
  title: string;
  start: Date;
  end: Date;
  /** open tasks in it */
  open: number;
}

export interface FocusRead {
  title: string;
  /** null for a hand-picked set — it has no time of its own */
  start: Date | null;
  end: Date | null;
  /** its tasks, open and done, in their own order (done ones stay in place, so
   *  a tick never reshuffles the list under your hand) */
  tasks: Task[];
  done: number;
  total: number;
  /** every task done */
  closed: boolean;
  /** when the last one was done */
  closedAt: Date | null;
  /** the block's hue (a slot's), or null */
  color: string | null;
}

const isOpen = (t: Task) => t.status !== "done" && t.status !== "trashed";

function blockEnd(start: Date, mins: number | null | undefined): Date {
  return new Date(start.getTime() + (mins ?? 30) * 60_000);
}

/** The latest completion among `tasks`, or null if any is still open. */
function closedAtOf(tasks: readonly Task[]): Date | null {
  if (tasks.length === 0 || tasks.some(isOpen)) return null;
  let last = 0;
  for (const t of tasks) {
    const c = t.completed_at ? new Date(t.completed_at).getTime() : 0;
    if (c > last) last = c;
  }
  return last ? new Date(last) : null;
}

/**
 * Read a focus against what the rail already holds.
 *
 * @param target  what you're focused on
 * @param pool    every task the rail can see (today's, done included, + inbox)
 * @param slots   today's slots
 * @param titleOf names a slot from what's inside it (an untitled slot)
 * @returns null when the target is gone (the slot was deleted, every picked
 *          task was trashed) — the caller ends the focus.
 */
export function readFocus(
  target: FocusTarget,
  pool: readonly Task[],
  slots: readonly Slot[],
  titleOf: (s: Slot, children: Task[]) => string = (s) => s.title,
): FocusRead | null {
  const live = pool.filter((t) => t.status !== "trashed");
  const make = (title: string, tasks: Task[], start: Date | null, end: Date | null, color: string | null): FocusRead => {
    const done = tasks.filter((t) => !isOpen(t)).length;
    const closedAt = closedAtOf(tasks);
    return { title, tasks, done, total: tasks.length, closed: tasks.length > 0 && done === tasks.length, closedAt, start, end, color };
  };

  if (target.kind === "slot") {
    const slot = slots.find((s) => s.id === target.slotId);
    if (!slot) return null;
    const tasks = live.filter((t) => t.slot_id === slot.id).sort((a, b) => a.sort_order - b.sort_order);
    const start = new Date(slot.start_time);
    return make(titleOf(slot, tasks.filter(isOpen)) || "Slot", tasks, start, blockEnd(start, slot.duration_minutes), slot.color);
  }

  if (target.kind === "task") {
    const t = live.find((x) => x.id === target.taskId);
    if (!t) return null;
    const start = t.start_time ? new Date(t.start_time) : null;
    const end = t.start_time ? endOf({ start_time: t.start_time, duration_minutes: t.duration_minutes }) : null;
    return make(t.title, [t], start, end, null);
  }

  const byId = new Map(live.map((t) => [t.id, t]));
  const tasks = target.taskIds.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t));
  if (tasks.length === 0) return null;
  return make("Focus", tasks, null, null, null);
}

/**
 * Today's blocks, in the order they happen: each slot with work in it, and each
 * lone timed task (a scheduled task IS a time block, P1). An empty slot is time,
 * not work — there is nothing in it to focus on (D-188).
 *
 * @param today today's tasks, slot children included (as the rail holds them)
 */
export function dayBlocks(
  today: readonly Task[],
  slots: readonly Slot[],
  titleOf: (s: Slot, children: Task[]) => string = (s) => s.title,
): FocusBlock[] {
  const out: FocusBlock[] = [];
  for (const s of slots) {
    const kids = today.filter((t) => t.slot_id === s.id && t.status !== "trashed");
    const open = kids.filter(isOpen);
    if (kids.length === 0) continue;
    const start = new Date(s.start_time);
    out.push({ target: { kind: "slot", slotId: s.id }, title: titleOf(s, open) || "Slot", start, end: blockEnd(start, s.duration_minutes), open: open.length });
  }
  for (const t of today) {
    if (t.slot_id || !t.start_time || t.status === "trashed") continue;
    const start = new Date(t.start_time);
    out.push({
      target: { kind: "task", taskId: t.id },
      title: t.title,
      start,
      end: endOf({ start_time: t.start_time, duration_minutes: t.duration_minutes }),
      open: isOpen(t) ? 1 : 0,
    });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
}

/** The blocks still worth focusing on: not over, with something left in them. */
export function blocksAhead(blocks: readonly FocusBlock[], now: Date): FocusBlock[] {
  return blocks.filter((b) => b.open > 0 && b.end.getTime() > now.getTime());
}

/**
 * What ⌘. focuses on when you haven't said: the block on the clock right now,
 * if it has anything left in it. When two overlap, the one that started last
 * (the one you just stepped into). Null → nothing is on the clock, and the
 * rail asks instead of guessing (P4: the app reports, you decide).
 */
export function blockOnNow(blocks: readonly FocusBlock[], now: Date): FocusBlock | null {
  const t = now.getTime();
  const on = blocks.filter((b) => b.open > 0 && b.start.getTime() <= t && b.end.getTime() > t);
  if (on.length === 0) return null;
  return on.reduce((a, b) => (b.start.getTime() > a.start.getTime() ? b : a));
}

/**
 * What comes after the focus — the first busy thing starting at or after the
 * block's end (or after now, for a set with no time). Busy is `toBusyBlocks`'s
 * call, never re-decided here; the focus's own tasks are left out.
 */
export function thenAfter(read: FocusRead, busy: readonly BusyBlock[], now: Date): BusyBlock | null {
  const from = Math.max(read.end?.getTime() ?? now.getTime(), now.getTime()) - 60_000;
  const own = new Set(read.tasks.map((t) => t.title));
  let best: BusyBlock | null = null;
  for (const b of busy) {
    if (b.kind === "block" && (b.done || own.has(b.title))) continue;
    const s = b.start.getTime();
    if (s < from) continue;
    if (!best || s < best.start.getTime()) best = b;
  }
  return best;
}

/** Same target? (A focus started twice is a no-op, not a restart.) */
export function sameTarget(a: FocusTarget | null, b: FocusTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "slot") return a.slotId === (b as typeof a).slotId;
  if (a.kind === "task") return a.taskId === (b as typeof a).taskId;
  const bb = (b as typeof a).taskIds;
  return a.taskIds.length === bb.length && a.taskIds.every((id, i) => id === bb[i]);
}
