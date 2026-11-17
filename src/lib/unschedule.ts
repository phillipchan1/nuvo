// Unschedule — what taking work off the calendar says, once.
//
// "Other priorities came up, clear the afternoon" is one act over several
// blocks. The WRITE is the existing `backToInbox` routing (D-063a): a loose
// task goes back to the Inbox, project work back to its project's backlog —
// never the Inbox, which is the triage queue for unfiled captures. This file is
// only the WORDS, so the single block, the calendar's selection and the bulk
// bar can't drift into three ways of saying where the work went.
//
// Two honesty rules (D-248):
//  - Name the destination (D-063a's lesson: a control that said *Inbox* and
//    meant *Stampede v3 backlog* made a task vanish).
//  - Say what was left alone. A selection over an afternoon catches meetings;
//    Unschedule never touches them, because taking a meeting off means
//    declining it, and a guest notice is never decided in bulk (D-158).
//  - A slot is time on the calendar too, so it unschedules: its tasks go back
//    (each where it came from) and a one-off slot comes off. A standing slot
//    is a rhythm, not today's plan — its tasks come off, the slot stays, and
//    the toast says so (skipping one day is Delete slot… → This occurrence).

import type { Task } from "./types";

/** Only work that has a day, a time or a slot can be unscheduled. */
export function isUnschedulable(t: Pick<Task, "do_date" | "start_time" | "slot_id" | "status">): boolean {
  if (t.status === "done" || t.status === "trashed") return false;
  return Boolean(t.do_date || t.start_time || t.slot_id);
}

/** Where one unscheduled task rests — the same routing `backToInbox` writes. */
export function unscheduleDestination(
  t: Pick<Task, "project_id">,
  projectName?: (id: string) => string | undefined,
): string {
  if (!t.project_id) return "Inbox";
  return projectName?.(t.project_id) ?? "its project";
}

export interface LeftAlone {
  /** Calendar events in the selection — moving one would mean declining it. */
  events?: number;
  /** Standing (repeating) slots — their tasks came off, the rhythm stays. */
  slots?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line a toast says after Unschedule. */
export function unscheduleSummary(destinations: readonly string[], left: LeftAlone = {}, cleared = 0): string {
  const n = destinations.length;
  const tail = [
    n && cleared ? `${plural(cleared, "slot")} cleared` : null,
    left.slots ? `${plural(left.slots, "repeating slot")} kept` : null,
    left.events ? `${plural(left.events, "event")} left alone` : null,
  ].filter(Boolean);
  const after = tail.length ? ` · ${tail.join(" · ")}` : "";
  if (n === 0 && cleared) return `Cleared ${plural(cleared, "slot")}${after}`;
  if (n === 0) return `Nothing to unschedule${after}`;
  const same = destinations.every((d) => d === destinations[0]);
  const where = same ? `back to ${destinations[0]}` : "each back where it came from";
  return `${n === 1 ? "Unscheduled" : `Unscheduled ${n}`} — ${where}${after}`;
}
