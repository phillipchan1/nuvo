// What deferring a project COSTS the calendar — in rows, and in words.
//
// The kernel (`clearProjectTime` in planningRules) decides which blocks and
// which work come off; this is the client half that turns that plan into the
// rows to write and the one sentence every surface says before you press.
// One spelling of the cost, so the Schedule's slot, the Week's Plan row, the
// record menu and the phone's sheet can't describe the same act four ways.

import { format } from "date-fns";
import type { Slot, Task } from "./types";
import { span } from "../components/mobile/dayPlan";
import {
  clearProjectTime,
  clearSlotTime,
  type ClearRange,
  type TimeClearing,
  type TimedSlot,
  type TimedTask,
} from "../../supabase/functions/_shared/planningRules.ts";

/** A clearing, resolved to the rows it touches. */
export interface TimeCost {
  /** slots that come off the grid */
  removed: Slot[];
  /** recurring slots that stay standing and are only emptied */
  emptied: Slot[];
  /** work that loses its day and its time */
  tasks: Task[];
}

export const NO_COST: TimeCost = { removed: [], emptied: [], tasks: [] };

const timedTask = (t: Task): TimedTask => ({
  id: t.id,
  projectId: t.project_id ?? null,
  status: t.status,
  doDate: t.do_date ?? null,
  slotId: t.slot_id ?? null,
});

const timedSlot = (s: Slot): TimedSlot => ({
  id: s.id,
  projectId: s.project_id ?? null,
  doDate: s.do_date,
  recurring: Boolean(s.recurrence_id),
});

function resolve(clearing: TimeClearing, tasks: Task[], slots: Slot[]): TimeCost {
  const remove = new Set(clearing.removeSlotIds);
  const empty = new Set(clearing.emptySlotIds);
  const release = new Set(clearing.taskIds);
  return {
    removed: slots.filter((s) => remove.has(s.id)).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    emptied: slots.filter((s) => empty.has(s.id)),
    tasks: tasks.filter((t) => release.has(t.id)),
  };
}

/** Steps are not tasks, and a range query can hand the same slot back twice. */
const realTasks = (tasks: Task[]): Task[] => tasks.filter((t) => !t.parent_task_id);
const unique = (slots: Slot[]): Slot[] => [...new Map(slots.map((s) => [s.id, s])).values()];

/** What taking a project out of `range` clears. */
export function projectTimeCost(projectId: string, range: ClearRange, tasks: Task[], slots: Slot[]): TimeCost {
  const live = realTasks(tasks);
  const all = unique(slots);
  return resolve(clearProjectTime(projectId, range, live.map(timedTask), all.map(timedSlot)), live, all);
}

/** What freeing one block clears. */
export function slotTimeCost(slot: Slot, tasks: Task[]): TimeCost {
  const live = realTasks(tasks);
  return resolve(clearSlotTime(timedSlot(slot), live.map(timedTask)), live, [slot]);
}

export const costIsEmpty = (c: TimeCost): boolean => c.removed.length === 0 && c.tasks.length === 0;

const blockLabel = (s: Slot): string => {
  const start = new Date(s.start_time);
  return `${format(start, "EEE")} ${span(start, new Date(start.getTime() + s.duration_minutes * 60_000))}`;
};

const list = (parts: string[]): string =>
  parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/** `Thu 2–4pm and 3 tasks` — the blocks by name (two, then a count), then the
 *  work. `null` when nothing is on the calendar to clear. */
export function costPhrase(c: TimeCost): string | null {
  if (costIsEmpty(c)) return null;
  const parts = c.removed.slice(0, 2).map(blockLabel);
  const more = c.removed.length - 2;
  if (more > 0) parts.push(`${more} more block${more === 1 ? "" : "s"}`);
  if (c.tasks.length > 0) parts.push(`${c.tasks.length} task${c.tasks.length === 1 ? "" : "s"}`);
  return list(parts);
}

/** The sentence said BEFORE the press. Stated, not warned (P4): it is the cost
 *  of an act you are free to take, and it is undoable. */
export function costSentence(c: TimeCost): string | null {
  const phrase = costPhrase(c);
  return phrase ? `This takes ${phrase} off the calendar. The work stays in the project.` : null;
}
