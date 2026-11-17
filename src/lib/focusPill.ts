// The focus pill's wire (D-242) — what the main window tells the floating pill,
// and what the pill asks it to do.
//
// The pill window is a MIRROR: it never signs in, never queries, never writes.
// Main reads the focus (lib/focus), flattens it to a snapshot, and sends it over
// a Tauri event; a tap in the pill comes back as an act, and main performs it
// with its own mutations. One reader, one writer — the ⌥Space panel's second
// session (and its token-rotation hazards, lib/authSync) is exactly what this
// avoids. WebKit delivers neither `storage` nor BroadcastChannel across
// webviews, so the events are the only channel.

import type { BusyBlock } from "./now";
import type { FocusRead, FocusTarget } from "./focus";

/** main → pill: the pill's whole state, or null (hide). */
export const FOCUS_PILL_STATE = "nuvo-focus-pill-state";
/** pill → main: a tap. */
export const FOCUS_PILL_ACT = "nuvo-focus-pill-act";
/** pill → main: I just loaded — send me what you have. */
export const FOCUS_PILL_HELLO = "nuvo-focus-pill-hello";
/** The pill window's label (tauri.conf.json). */
export const FOCUS_PILL_WINDOW = "focus";

/** Everything the pill draws, as plain data (times as epoch ms). */
export interface FocusPillSnapshot {
  /** the block's name ("Morning Focus"), or the task's when the focus is one task */
  title: string;
  /** the open task the pill is on, or null when the focus has closed */
  task: { id: string; title: string } | null;
  done: number;
  total: number;
  closed: boolean;
  closedAt: number | null;
  start: number | null;
  end: number | null;
  /** what comes after (toBusyBlocks' first busy thing past the end) */
  then: { title: string; start: number } | null;
  /** say the block's name on the line (not when the focus IS one task) */
  named: boolean;
  theme: "light" | "dark";
}

export type FocusPillAct =
  | { act: "complete"; taskId: string }
  | { act: "show" }
  | { act: "next" }
  | { act: "leave" };

const isOpen = (s: string) => s !== "done" && s !== "trashed";

/** Flatten a read for the wire. */
export function pillSnapshot(
  target: FocusTarget,
  read: FocusRead,
  then: BusyBlock | null,
  theme: "light" | "dark",
): FocusPillSnapshot {
  const task = read.closed ? null : (read.tasks.find((t) => isOpen(t.status)) ?? null);
  return {
    title: read.title,
    task: task ? { id: task.id, title: task.title } : null,
    done: read.done,
    total: read.total,
    closed: read.closed,
    closedAt: read.closedAt?.getTime() ?? null,
    start: read.start?.getTime() ?? null,
    end: read.end?.getTime() ?? null,
    then: then ? { title: then.title, start: then.start.getTime() } : null,
    named: target.kind !== "task",
    theme,
  };
}

/** The snapshot back as the shape `focusLine` reads — so the pill's line is the
 *  rail's line by construction, ticked by the pill's own clock. */
export function pillRead(s: FocusPillSnapshot): { read: FocusRead; then: BusyBlock | null } {
  const d = (ms: number | null) => (ms == null ? null : new Date(ms));
  return {
    read: {
      title: s.title,
      tasks: [],
      done: s.done,
      total: s.total,
      closed: s.closed,
      closedAt: d(s.closedAt),
      start: d(s.start),
      end: d(s.end),
      color: null,
    },
    then: s.then ? { title: s.then.title, start: new Date(s.then.start), end: new Date(s.then.start), kind: "event" } : null,
  };
}
