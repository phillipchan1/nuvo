// Intelligent slot titles. A time slot is a container; making the user name
// every one is friction. So `slot.title` is treated as an optional *override*:
// when it's blank we derive a display title from what the slot actually holds —
// its project, its children's shared domain, or just the hour of day.
//
// And the drop rules for blocks that hold work: what letting go on a task or a
// slot does, decided once here so the drag tracker (what it shows) and the drop
// handlers (what they write) can't disagree.

import type { Slot, Task } from "./types";
import { toDateISO } from "./dates";
import { domainById, projectById, taskDomainId, type VerticalData } from "./vertical";
// One rule for "how big is this block", shared with the chat's `create_slot`.
import { sizeSlotToContents } from "../../supabase/functions/_shared/slotSizing.ts";

/** How wide the left/right "place beside" bands are on a block (px). */
export const BLOCK_DROP_EDGE_PX = 28;

/** Below this a block has no edges to aim at — all of it is middle (px). */
const BLOCK_DROP_NARROW_PX = 64;

/**
 * How long the pointer rests in a task's middle before letting go there makes
 * a slot of the two.
 *
 * Joining a slot makes nothing, so it arms at once. Combining *makes* a block,
 * and a drag swept across a busy Tuesday must not offer that on every block it
 * passes over — the same beat a phone's home screen waits before it makes a
 * folder.
 */
export const COMBINE_DWELL_MS = 300;

/** Where on a block the pointer is: the middle gathers, the edges place beside. */
export type BlockDropZone = "inside" | "beside";

/**
 * What letting go in the MIDDLE of a block does.
 *
 *  - `join`    — work dropped on a slot goes in it (unchanged since D-098).
 *  - `combine` — work dropped on a task: the two become one new slot, at the
 *                task's time.
 *  - `absorb`  — a slot dropped on a task: the slot moves to the task's time
 *                and takes it in.
 *  - `merge`   — a slot dropped on a slot: the target takes the other's work,
 *                and the other goes. Never nesting — a slot holds tasks, not
 *                slots (P10: no second container, no new noun).
 *
 * The rule under all four: **the block you drop on doesn't move; what you
 * carry comes to it.**
 */
export type GatherAct = "join" | "combine" | "absorb" | "merge";

/** What's in hand, as far as gathering cares. */
export type DragPayload =
  | { kind: "tasks"; tasks: readonly Task[] }
  | { kind: "slot"; slot: Slot; children: readonly Task[] }
  | { kind: "project" }
  | { kind: "other" };

/** The block under the pointer. */
export type DropTarget =
  | { kind: "task"; task: Pick<Task, "id" | "status" | "start_time"> }
  | { kind: "slot"; slot: Slot };

/**
 * The block under the pointer, frozen for the drop handler. `act` is null when
 * the drop lands **beside** it — the pointer was on an edge, the middle of a
 * task hadn't armed yet, or the middle can't gather what's in hand. A null act
 * is still an answer: it stops the time-range fallback from joining the slot
 * the pointer was deliberately placed beside.
 */
export type BlockDropIntent = { kind: "task" | "slot"; id: string; act: GatherAct | null };

/** Classify pointer position within a block's screen rect. */
export function blockDropZoneFromPointer(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">,
  clientX: number,
  clientY: number,
): BlockDropZone | null {
  if (clientY < rect.top || clientY > rect.bottom) return null;
  if (clientX < rect.left || clientX > rect.right) return null;
  // A block already sharing its hour three ways is too narrow to aim at an
  // edge of — all of it is middle. (On a task the pause still guards it.)
  if (rect.width < BLOCK_DROP_NARROW_PX) return "inside";
  const edge = Math.min(BLOCK_DROP_EDGE_PX, Math.max(12, rect.width * 0.22));
  if (clientX < rect.left + edge || clientX > rect.right - edge) return "beside";
  return "inside";
}

/**
 * What the middle of `target` would do with `payload` — or null, when the only
 * honest drop there is beside it. Each null is a thing that would be lost:
 *
 *  - **A finished task** is a record of what happened, not a container.
 *  - **An event** is never anyone's child: slots hold tasks.
 *  - **A project** dragged whole lands as its own sitting; D-109's offer already
 *    asks about its work that sits elsewhere.
 *  - **Merging an empty slot** would be deleting it by drop.
 *  - **A repeating slot's occurrence** can't be merged away — removing one is a
 *    "this or the series?" question, never a drop's side effect.
 *  - **Another project's sitting** can't be merged in: the project would be left
 *    with no time this week, and the week would plan it a second one.
 */
export function gatherActFor(payload: DragPayload, target: DropTarget): GatherAct | null {
  if (payload.kind === "other") return null;

  if (target.kind === "slot") {
    if (payload.kind === "tasks" || payload.kind === "project") return "join";
    const from = payload.slot;
    const into = target.slot;
    if (from.id === into.id) return null;
    if (!payload.children.some((t) => t.status !== "trashed")) return null;
    if (from.recurrence_id) return null;
    if (from.project_id && from.project_id !== into.project_id) return null;
    return "merge";
  }

  const task = target.task;
  if (task.status === "done" || task.status === "trashed" || !task.start_time) return null;
  if (payload.kind === "project") return null;
  if (payload.kind === "slot") return "absorb";
  const carried = payload.tasks.filter((t) => t.id !== task.id);
  if (carried.length === 0) return null;
  if (carried.some((t) => t.status === "done")) return null;
  return "combine";
}

/** Minutes from `start` to the next midnight — a slot is one day's row. */
export function minutesLeftInDay(start: Date): number {
  const midnight = new Date(start);
  midnight.setHours(24, 0, 0, 0);
  return Math.round((midnight.getTime() - start.getTime()) / 60_000);
}

/**
 * How long a block that holds these pieces runs from `start` — the kernel's
 * size (sum, 30m floor, quarter hour), cut at midnight, and never shorter than
 * `atLeast`: a block you sized by hand is a reason to make room, never a reason
 * to take it away (D-109).
 */
export function slotMinutesFor(
  durations: (number | null | undefined)[],
  start: Date,
  atLeast = 0,
): number {
  const sized = Math.min(sizeSlotToContents(durations), Math.max(15, minutesLeftInDay(start)));
  return Math.max(atLeast, sized);
}

export type ResolvedBlockDrop =
  | { kind: "join"; slot: Slot }
  | { kind: "merge"; slot: Slot }
  | { kind: "combine"; task: Task }
  | { kind: "absorb"; task: Task }
  | { kind: "beside" };

/**
 * Resolve a drop against the block the pointer was over.
 *
 * The intent wins — it's what lit up under the cursor. With no intent at all
 * (a drop the pointer watch didn't see), a task dropped at a time inside a slot
 * still joins it; that fallback is never consulted when the pointer was
 * deliberately put beside a block.
 */
export function resolveBlockDrop(
  dropStart: Date,
  intent: BlockDropIntent | null,
  slots: readonly Slot[],
  findTask: (id: string) => Task | undefined,
): ResolvedBlockDrop | null {
  if (intent) {
    if (!intent.act) return { kind: "beside" };
    if (intent.kind === "slot") {
      const slot = slots.find((s) => s.id === intent.id);
      if (!slot) return { kind: "beside" };
      return intent.act === "merge" ? { kind: "merge", slot } : { kind: "join", slot };
    }
    const task = findTask(intent.id);
    if (!task?.start_time) return { kind: "beside" };
    return intent.act === "absorb" ? { kind: "absorb", task } : { kind: "combine", task };
  }
  const t0 = dropStart.getTime();
  const slot = slots.find((s) => {
    const ss = new Date(s.start_time).getTime();
    return t0 >= ss && t0 < ss + s.duration_minutes * 60_000;
  });
  return slot ? { kind: "join", slot } : null;
}

export type MakeSlotPlan =
  | { kind: "create"; tasks: Task[]; start: Date }
  | { kind: "gather"; slot: Slot; tasks: Task[] }
  | { kind: "merge"; into: Slot; from: Slot }
  | { kind: "none"; reason: string };

/**
 * **⌘G — what a selection of blocks becomes**, the keyboard's twin of dropping
 * one onto another (the drag can't be the only way to an act).
 *
 *  - Tasks only → one new slot holding them, at the earliest time among them.
 *  - Tasks and one slot → the tasks go into that slot.
 *  - Two slots → one, by `gatherActFor`'s merge guards, in whichever direction
 *    they allow (the earlier receives when both do).
 *
 * Finished tasks and events stay where they are — they're never anyone's
 * children — and anything else is said rather than guessed at.
 */
export function planMakeSlot(
  pick: { tasks: readonly Task[]; slots: readonly Slot[] },
  childrenOf: (slotId: string) => readonly Task[],
): MakeSlotPlan {
  const tasks = pick.tasks.filter((t) => t.status !== "done" && t.status !== "trashed");
  const slots = [...pick.slots].sort((a, b) => a.start_time.localeCompare(b.start_time));

  if (slots.length === 0) {
    if (tasks.length < 2) return { kind: "none", reason: "Select two or more tasks to make a slot" };
    const times = tasks.filter((t) => t.start_time).map((t) => new Date(t.start_time!).getTime());
    if (!times.length) return { kind: "none", reason: "A slot starts at a time — select a block that has one" };
    return { kind: "create", tasks, start: new Date(Math.min(...times)) };
  }

  if (slots.length === 1) {
    if (!tasks.length) return { kind: "none", reason: "Select tasks with the slot to put them in it" };
    return { kind: "gather", slot: slots[0], tasks };
  }

  if (slots.length === 2 && tasks.length === 0) {
    const [early, late] = slots;
    const merges = (from: Slot, into: Slot) =>
      gatherActFor({ kind: "slot", slot: from, children: childrenOf(from.id) }, { kind: "slot", slot: into }) === "merge";
    if (merges(late, early)) return { kind: "merge", into: early, from: late };
    if (merges(early, late)) return { kind: "merge", into: late, from: early };
    return {
      kind: "none",
      reason: "These two stay apart — one is empty, repeats, or holds another project's time",
    };
  }

  return { kind: "none", reason: "Make a slot takes tasks and one slot, or two slots" };
}

/** One row of the phone's "Put in a slot" list, and what tapping it does. */
export type SlotPick =
  | { kind: "slot"; slot: Slot; act: "join" }
  | { kind: "task"; task: Task; act: "combine" };

/**
 * The day a task's "Put in a slot" list is read from: the day it sits on, or
 * today for work with no day yet (the same day a drag from the rail lands it on).
 */
export function slotPickDay(task: Pick<Task, "start_time" | "do_date">, today: string): string {
  if (task.start_time) return toDateISO(new Date(task.start_time));
  return task.do_date ?? today;
}

/**
 * **"Put in a slot": what a task can be gathered with, without a drag** (D-172).
 *
 * The phone's calendar has no drag, so the task sheet lists what dropping the
 * task on a block would do on the desktop. That day's **slots** are listed (the
 * task joins one), and so are its **timed tasks** (the two combine into a new
 * slot at that task's time, because the block you pick doesn't move). Every row
 * is one `gatherActFor` says yes to, so a tap and a drop can't disagree about
 * what gathers.
 *
 *  - A finished task is never anyone's child (`planMakeSlot`'s filter), so it
 *    gets no list at all.
 *  - The slot it's already in is left out, because joining it would do nothing.
 *  - Events are never listed: a slot holds tasks.
 *
 * The rows come in the day's own order, earliest first, so the blocks next to
 * this one are next to each other on the list. The whole day is listed, not a
 * window around the task's time, because a window would hide the evening slot
 * you meant to put it in.
 */
export function slotPicksFor(
  task: Task,
  day: string,
  blocks: { slots: readonly Slot[]; tasks: readonly Task[] },
): SlotPick[] {
  if (task.status === "done" || task.status === "trashed") return [];
  const carried: DragPayload = { kind: "tasks", tasks: [task] };
  const onDay = (iso: string) => toDateISO(new Date(iso)) === day;
  const picks: { at: number; pick: SlotPick }[] = [];
  for (const slot of blocks.slots) {
    if (slot.id === task.slot_id || !onDay(slot.start_time)) continue;
    if (gatherActFor(carried, { kind: "slot", slot }) !== "join") continue;
    picks.push({ at: new Date(slot.start_time).getTime(), pick: { kind: "slot", slot, act: "join" } });
  }
  for (const other of blocks.tasks) {
    if (other.id === task.id || !other.start_time || !onDay(other.start_time)) continue;
    if (gatherActFor(carried, { kind: "task", task: other }) !== "combine") continue;
    picks.push({ at: new Date(other.start_time).getTime(), pick: { kind: "task", task: other, act: "combine" } });
  }
  return picks.sort((a, b) => a.at - b.at).map((p) => p.pick);
}

/** Morning / Midday / Afternoon / Evening from a start instant. */
export function partOfDay(start: Date): string {
  const h = start.getHours();
  if (h < 11) return "Morning";
  if (h < 14) return "Midday";
  if (h < 18) return "Afternoon";
  return "Evening";
}

/**
 * The best title for a slot, in priority order:
 *   1. an explicit override the user typed
 *   2. the slot's project name
 *   3. a domain shared by all its children (+ "block")
 *   4. the single child's title, or a time-of-day label with a task count
 *   5. a plain time-of-day label
 * Pure + synchronous so the calendar render and the popover agree.
 */
export function deriveSlotTitle(
  slot: Pick<Slot, "title" | "start_time" | "project_id" | "domain_id">,
  children: Task[],
  vertical: VerticalData,
): string {
  const override = slot.title?.trim();
  if (override) return override;

  const project = projectById(vertical, slot.project_id);
  if (project) return project.name;

  const open = children.filter((c) => c.status !== "trashed");
  const part = partOfDay(new Date(slot.start_time));

  // A domain the slot (or all its children) clearly belongs to.
  const slotDomain = domainById(vertical, slot.domain_id);
  if (slotDomain) return `${slotDomain.name} block`;
  if (open.length > 0) {
    // `taskDomainId`, never the row's own `domain_id` — that column is a
    // denormalized copy of the parent's domain and goes stale the moment a
    // project is re-homed (D-088). A slot full of one project's tasks would
    // otherwise take its name from whichever domain the copy last remembered.
    const ids = open.map((c) => taskDomainId(vertical, c));
    const first = ids[0];
    if (first && ids.every((d) => d === first)) {
      const dom = domainById(vertical, first);
      if (dom) return `${dom.name} block`;
    }
  }

  if (open.length === 1) return open[0].title;
  if (open.length > 1) return `${part} · ${open.length} tasks`;
  return `${part} block`;
}

/** True when the slot has no user-typed title — i.e. the display is derived. */
export function slotTitleIsDerived(slot: Pick<Slot, "title">): boolean {
  return !slot.title?.trim();
}

/** What a block IS — the designation, not its name. */
export interface BlockDesignation {
  /** project sitting · a plain slot · a single piece of work */
  kind: "project" | "slot" | "task";
  /** one sitting of a run that was split across days */
  part?: { part: number; parts: number } | null;
  /** how many pieces it holds — omitted where the surface already counts them */
  holds?: number | null;
  /** what the pieces are called at this altitude */
  unit?: "task" | "capture";
  /** the project behind it, when the block's own title doesn't already say it */
  name?: string | null;
}

/**
 * **The words a block wears** — `Project · 3 tasks`, `Slot · 2 captures`, `Task`.
 *
 * Plan the week says this over every block it places; the Schedule said it with
 * a `▸`, which asks you to learn a glyph before you can read your own calendar.
 * One spelling now, so protected project time reads the same in the ritual that
 * proposes it, on the grid that holds it, and on the phone that shows it.
 *
 * A surface passes only the facts it has room for: the ritual's grid carries the
 * count (it has no progress badge), the Schedule leaves it to the `2/3` badge and
 * passes the project name instead — but only when its own title isn't already
 * the project's, since a block that says `Frontier Site` twice says it once.
 */
export function blockDesignation(d: BlockDesignation): string {
  const kind = d.kind === "project" ? "Project" : d.kind === "slot" ? "Slot" : "Task";
  if (d.part && d.part.parts > 1) return `${kind} · part ${d.part.part} of ${d.part.parts}`;
  if (d.holds != null && d.holds > 0) {
    const unit = d.unit ?? "task";
    return `${kind} · ${d.holds} ${unit}${d.holds === 1 ? "" : "s"}`;
  }
  const name = d.name?.trim();
  if (name) return `${kind} · ${name}`;
  return kind;
}
