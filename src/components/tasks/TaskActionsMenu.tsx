/**
 * The row's actions — right-click, or `.` — shared by every task list.
 *
 * Moved out of the rail so the record and the slot offer the same verbs with
 * the same key hints, and the hints say the keys the lists actually bind
 * (`useTaskListKeys`). A hidden gesture is never the only path to an act: every
 * key here has this menu, and the menu is one right-click away.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../../lib/types";
import { nextWeekISO, todayISO, tomorrowISO } from "../../lib/dates";
import { isTypingIn } from "../../lib/a11y";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useRecurrenceMutations, useRecurrences } from "../../hooks/useRecurrence";
import { useVertical } from "../../hooks/useVertical";

type Mutations = ReturnType<typeof useTaskMutations>;
const TRIAGE_UNDO = { undo: "toast" as const };

export default function TaskActionsMenu({
  task,
  x,
  y,
  mutations,
  onOpen,
  onClose,
  onDate,
  onMove,
  onRename,
  onSchedule,
  onLabel,
}: {
  task: Task;
  x: number;
  y: number;
  mutations: Mutations;
  onOpen: (anchor: DOMRect) => void;
  onClose: () => void;
  /** `t` — the when menu. */
  onDate?: () => void;
  /** `v` — the move menu. */
  onMove?: () => void;
  /** ⌘E — rename in place. */
  onRename?: () => void;
  /** A date-and-clock form, for when words won't do. */
  onSchedule?: () => void;
  onLabel?: () => void;
}) {
  const { data: vertical, toggleTaskSprint } = useVertical();
  const now = new Date();
  const [deleteMode, setDeleteMode] = useState(false);
  const { data: recurrences = [] } = useRecurrences();
  const recurrenceMutations = useRecurrenceMutations();
  const recurrence = task.recurrence_id
    ? recurrences.find((r) => r.id === task.recurrence_id) ?? null
    : null;
  const recurring = Boolean(task.recurrence_id && recurrence);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  // The menu is ~14 rows, not the 260px the first clamp budgeted, so Trash
  // (last item) sat below the viewport on a Today row in the lower half of
  // the rail. Clicks there hit the scrim and the menu closed; the task stayed.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      left: Math.max(8, Math.min(x, vw - width - 8)),
      top: Math.max(8, Math.min(y, vh - height - 8)),
    });
  }, [x, y, deleteMode]);

  const trashTask = () => {
    mutations.trash(task);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        if (deleteMode) setDeleteMode(false);
        else onClose();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (isTypingIn(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        mutations.trash(task);
        onClose();
      }
    };
    // No full-screen scrim — a same-z overlay sat on top of Trash and ate the
    // click (and a 250ms guard made the first click a no-op). Dismiss the same
    // way the calendar menus do: pointerdown outside.
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose, deleteMode, task, mutations]);

  const done = task.status === "done";
  const inWeek = Boolean(task.sprint_id && task.sprint_id === vertical.sprint?.id);

  type Item =
    | { kind: "action"; label: string; key?: string; danger?: boolean; action: () => void }
    | { kind: "sep" }
    | { kind: "label"; label: string };

  const deleteItems: Item[] = [
    { kind: "label", label: "Delete" },
    {
      kind: "action",
      label: "This occurrence",
      action: () => {
        if (recurrence && task.recurrence_date) recurrenceMutations.skipOccurrence(recurrence, task.recurrence_date);
        mutations.trash(task);
        onClose();
      },
    },
    {
      kind: "action",
      label: "This & following",
      action: () => {
        if (recurrence && task.do_date) recurrenceMutations.deleteFollowing(recurrence, task.do_date);
        onClose();
      },
    },
    {
      kind: "action",
      label: "Whole series",
      action: () => {
        if (recurrence) recurrenceMutations.deleteSeries(recurrence);
        onClose();
      },
    },
    { kind: "sep" },
    { kind: "action", label: "Cancel", action: () => setDeleteMode(false) },
  ];

  const items: Item[] = deleteMode && recurring
    ? deleteItems
    : [
    {
      kind: "action", label: "Open", key: "↵",
      action: () => {
        const el = document.querySelector<HTMLElement>(`[data-task-drag="${task.id}"]`);
        onOpen(el?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40));
      },
    },
    { kind: "sep" },
    ...(onRename ? [{ kind: "action" as const, label: "Rename", key: "⌘E", action: () => { onClose(); onRename(); } }] : []),
    { kind: "sep" },
    { kind: "action", label: "Today", action: () => { mutations.planFor(task, todayISO(now), TRIAGE_UNDO); onClose(); } },
    { kind: "action", label: "Tomorrow", action: () => { mutations.planFor(task, tomorrowISO(), TRIAGE_UNDO); onClose(); } },
    { kind: "action", label: "Next week", action: () => { mutations.planFor(task, nextWeekISO(), TRIAGE_UNDO); onClose(); } },
    ...(onDate ? [{ kind: "action" as const, label: "When…", key: "T", action: () => { onClose(); onDate(); } }] : []),
    ...(onSchedule ? [{ kind: "action" as const, label: "Pick a time…", action: onSchedule }] : []),
    ...(onMove ? [{ kind: "action" as const, label: "Move to…", key: "V", action: () => { onClose(); onMove(); } }] : []),
    ...(task.status !== "inbox" ? [{ kind: "action" as const, label: "Return to inbox", action: () => { mutations.backToInbox(task, TRIAGE_UNDO); onClose(); } }] : []),
    ...(task.status === "inbox" && (task.project_id || task.initiative_id || task.domain_id)
      ? [{ kind: "action" as const, label: "File to project", action: () => { mutations.fileToProject(task); onClose(); } }]
      : []),
    { kind: "sep" },
    {
      kind: "action",
      label: inWeek ? "Remove from week" : "Commit to this week",
      action: () => { toggleTaskSprint(task.id); onClose(); },
    },
    { kind: "sep" },
    {
      kind: "action",
      label: done ? "Reopen" : "Mark done",
      key: "E",
      action: () => {
        done ? mutations.uncomplete(task) : mutations.complete(task);
        onClose();
      },
    },
    ...(onLabel ? [{ kind: "action" as const, label: "Label…", key: "#", action: onLabel }] : []),
    { kind: "sep" },
    recurring
      ? {
          kind: "action" as const,
          label: "Trash…",
          key: "⌫",
          danger: true,
          action: () => setDeleteMode(true),
        }
      : {
          kind: "action" as const,
          label: "Trash",
          key: "⌫",
          danger: true,
          action: trashTask,
        },
  ];

  return createPortal(
    <div
      ref={menuRef}
      data-nested-surface=""
      className="rise elev-3 fixed z-[70] w-[200px] overflow-y-auto rounded-[var(--radius)] border border-line bg-surface py-1"
      style={{ top: pos.top, left: pos.left, maxHeight: "calc(100vh - 16px)" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.kind === "sep")
          return <div key={i} className="my-1 border-t border-line" />;
        if (item.kind === "label")
          return (
            <div key={i} className="mono px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted">
              {item.label}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              item.action();
            }}
            className={`fast flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption hover:bg-bg ${
              item.danger ? "text-signal" : "text-text"
            }`}
          >
            <span className="flex-1">{item.label}</span>
            {item.key && (
              <span className="mono text-meta text-muted">{item.key}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

