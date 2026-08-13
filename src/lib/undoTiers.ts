/**
 * Undo tiers — two channels so calendar drags stay quiet while fat-finger
 * completes/trashes stay recoverable. See docs/product/decisions.md (undo stack).
 *
 *   toast  — push stack + sonner with Undo (mobile's only recovery path)
 *   silent — push stack only; ⌘Z on desktop/Tauri
 */

export type UndoTier = "toast" | "silent";

/** Override or suppress undo recording on a mutation. */
export type UndoMode = UndoTier | false;

export interface UndoOpts {
  /** Override the helper's default tier, or `false` to skip recording. */
  undo?: UndoMode;
  /** Merge rapid same-family actions into one stack entry / toast. */
  coalesceKey?: string;
  /** Toast / stack label override (e.g. D-063a destination name). */
  label?: string;
}

/** Default tier for named task acts. Call sites that differ (keyboard triage
 *  wants toast for planFor; calendar drag wants silent) pass `opts.undo`. */
export const TASK_UNDO_DEFAULT: Record<
  | "complete"
  | "uncomplete"
  | "trash"
  | "restore"
  | "planFor"
  | "block"
  | "assignToSlot"
  | "backToInbox"
  | "backToWeek"
  | "unblock"
  | "removeFromSlot"
  | "fileToProject",
  UndoTier
> = {
  complete: "toast",
  uncomplete: "toast",
  trash: "toast",
  // Undoing a restore puts the task back in the trash — recoverable either way,
  // but the toast is the phone's only ⌘Z, so it gets one.
  restore: "toast",
  // Calendar-heavy by default; LeftRail keyboard / tab drop pass `undo: "toast"`.
  planFor: "silent",
  block: "silent",
  assignToSlot: "silent",
  backToInbox: "silent",
  backToWeek: "silent",
  unblock: "silent",
  removeFromSlot: "silent",
  fileToProject: "toast",
};

export const COALESCE = {
  complete: "complete",
  uncomplete: "uncomplete",
  trash: "trash",
  plan: "plan",
  move: "move",
} as const;

const COALESCE_MS = 1500;

export function undoCoalesceWindowMs() {
  return COALESCE_MS;
}

/** Full toast / stack label. */
export function undoLabel(
  kind: keyof typeof TASK_UNDO_DEFAULT,
  title: string,
  count = 1,
): string {
  if (count > 1) {
    switch (kind) {
      case "complete":
        return `${count} tasks marked done`;
      case "uncomplete":
        return `${count} tasks reopened`;
      case "trash":
        return `${count} tasks deleted`;
      case "restore":
        return `${count} tasks restored`;
      case "planFor":
        return `${count} tasks planned`;
      case "backToInbox":
        return `${count} tasks returned`;
      default:
        return `${count} changes`;
    }
  }
  switch (kind) {
    case "complete":
      return `Marked done — ${title}`;
    case "uncomplete":
      return `Reopened — ${title}`;
    case "trash":
      return `Task deleted`;
    case "restore":
      return `Restored — ${title}`;
    case "planFor":
      return `Planned — ${title}`;
    case "block":
      return `Scheduled — ${title}`;
    case "assignToSlot":
      return `Into slot — ${title}`;
    case "backToInbox":
      return `Returned — ${title}`;
    case "backToWeek":
      return `Back to week — ${title}`;
    case "unblock":
      return `Unblocked — ${title}`;
    case "removeFromSlot":
      return `Out of slot — ${title}`;
    case "fileToProject":
      return `Filed — ${title}`;
  }
}

/** Short phrase for the post-⌘Z confirmation ("Undid: Marked done"). */
export function undoShortLabel(kind: keyof typeof TASK_UNDO_DEFAULT, count = 1): string {
  if (count > 1) {
    switch (kind) {
      case "complete":
        return `${count} marked done`;
      case "uncomplete":
        return `${count} reopened`;
      case "trash":
        return `${count} deleted`;
      case "restore":
        return `${count} restored`;
      default:
        return `${count} changes`;
    }
  }
  switch (kind) {
    case "complete":
      return "Marked done";
    case "uncomplete":
      return "Reopened";
    case "trash":
      return "Task deleted";
    case "restore":
      return "Restored";
    case "planFor":
      return "Planned";
    case "block":
      return "Scheduled";
    case "assignToSlot":
      return "Into slot";
    case "backToInbox":
      return "Returned";
    case "backToWeek":
      return "Back to week";
    case "unblock":
      return "Unblocked";
    case "removeFromSlot":
      return "Out of slot";
    case "fileToProject":
      return "Filed";
  }
}

export function resolveUndoTier(
  defaultTier: UndoTier,
  opts?: UndoOpts,
): UndoTier | false {
  if (opts?.undo === false) return false;
  if (opts?.undo === "toast" || opts?.undo === "silent") return opts.undo;
  return defaultTier;
}
