/**
 * The task's actions — right-click, or `.` — shared by every task list AND by a
 * task's block on the calendar.
 *
 * Moved out of the rail so the record and the slot offer the same verbs with
 * the same key hints, and the hints say the keys the lists actually bind
 * (`useTaskListKeys`). A hidden gesture is never the only path to an act: every
 * key here has this menu, and the menu is one right-click away.
 *
 * The calendar used to build its own five-item copy (Open · Mark done ·
 * Duplicate · → Event · Trash), so a block could be ticked but not sent to
 * tomorrow, back to the Inbox or into the week — the D-111 drift, one surface
 * over. A block now gets THIS menu; the acts only a block has (Duplicate,
 * → Event) ride in through props.
 *
 * Keyboard: ↑ ↓ walk the items, ↵ runs the lit one (or opens the task when
 * none is lit), and every letter the menu prints runs its item — a hint that
 * did nothing while the menu was open was a lie in a menu's own words.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../../lib/types";
import { nextWeekISO, sameClockOn, todayISO, tomorrowISO } from "../../lib/dates";
import { isTypingIn } from "../../lib/a11y";
import { at } from "../mobile/dayPlan";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useRecurrenceMutations, useRecurrences } from "../../hooks/useRecurrence";
import { useVertical } from "../../hooks/useVertical";
import { useOptionalUndoStack } from "../../hooks/useUndoStack";
import { fixedCssPx } from "../../hooks/useUiScale";

type Mutations = ReturnType<typeof useTaskMutations>;
const TRIAGE_UNDO = { undo: "toast" as const };

/** Commit a task to this week, or take it off — said, and undoable. Committing
 *  an inbox row usually takes it OFF the list you're looking at (it becomes
 *  week work, in Spread), and with no word that read as "it vanished". */
export function useWeekCommitAct(mutations: Mutations) {
  const { data: vertical, toggleTaskSprint } = useVertical();
  const { recordUndo } = useOptionalUndoStack();
  return (task: Task) => {
    const inWeek = Boolean(task.sprint_id && task.sprint_id === vertical.sprint?.id);
    const before = { sprint_id: task.sprint_id, status: task.status };
    toggleTaskSprint(task.id);
    recordUndo({
      label: inWeek ? `Off this week — ${task.title}` : `Committed to this week — ${task.title}`,
      shortLabel: inWeek ? "Off the week" : "Committed",
      tier: "toast",
      undo: () => mutations.patchTask(task.id, before, { undo: false }),
      redo: () => toggleTaskSprint(task.id),
    });
  };
}

/** Move a task to a day by hand. A timed task keeps its clock; an untimed one
 *  is planned for the day, as before. */
export function moveToDay(mutations: Mutations, task: Task, dateISO: string) {
  const start = sameClockOn(task, dateISO);
  if (start) mutations.block(task, start, task.duration_minutes ?? undefined, TRIAGE_UNDO);
  else mutations.planFor(task, dateISO, TRIAGE_UNDO);
}

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
  onToggleDone,
  onDuplicate,
  onToEvent,
  onMakeSlot,
  startInDelete = false,
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
  /** The host's own completion (the calendar paints the block this frame and
   *  completes the right occurrence of a series). Defaults to the mutation. */
  onToggleDone?: () => void;
  /** Acts only some hosts have — the calendar's Duplicate and → Event. */
  onDuplicate?: () => void;
  onToEvent?: { label: string; action: () => void };
  /** The calendar's ⌘G, offered when the menu opened on a block inside a lit
   *  selection: what's lit becomes one slot. */
  onMakeSlot?: () => void;
  /** Open on the series' delete scope — ⌫ on a calendar block (D-158) asks the
   *  same question, in the same place, as ⌫ inside this menu. */
  startInDelete?: boolean;
}) {
  const { data: vertical } = useVertical();
  const commitToWeek = useWeekCommitAct(mutations);
  const now = new Date();
  const [deleteMode, setDeleteMode] = useState(startInDelete);
  const [lit, setLit] = useState(-1);
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

  const done = task.status === "done";
  const inWeek = Boolean(task.sprint_id && task.sprint_id === vertical.sprint?.id);
  const timed = Boolean(task.start_time);
  const clock = timed ? at(new Date(task.start_time!)) : null;
  const toggleDone = () => {
    if (onToggleDone) onToggleDone();
    else if (done) mutations.uncomplete(task);
    else mutations.complete(task);
  };

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
    // Opened on the question (⌫ on a block): backing out of it closes the menu —
    // there is no menu behind it the user came from.
    { kind: "action", label: "Cancel", action: () => (startInDelete ? onClose() : setDeleteMode(false)) },
  ];

  // A day you pick by hand keeps the hour you chose; the label says so, so the
  // difference from an untimed row's "Tomorrow" is read, not discovered. The
  // day the task is already on isn't offered — it would be a no-op.
  const dayItem = (label: string, dateISO: string): Item[] =>
    task.do_date === dateISO
      ? []
      : [{
          kind: "action",
          label: clock ? `${label} · ${clock}` : label,
          action: () => { moveToDay(mutations, task, dateISO); onClose(); },
        }];

  const items: Item[] = deleteMode && recurring
    ? deleteItems
    : [
    ...(onMakeSlot
      ? [
          { kind: "action" as const, label: "Make one slot", key: "⌘G", action: () => { onClose(); onMakeSlot(); } },
          { kind: "sep" as const },
        ]
      : []),
    {
      kind: "action", label: "Open", key: "↵",
      action: () => {
        const el = document.querySelector<HTMLElement>(`[data-task-drag="${task.id}"]`);
        onOpen(el?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40));
      },
    },
    ...(onRename ? [{ kind: "action" as const, label: "Rename", key: "⌘E", action: () => { onClose(); onRename(); } }] : []),
    {
      kind: "action",
      label: done ? "Reopen" : "Mark done",
      key: "E",
      action: () => { toggleDone(); onClose(); },
    },
    { kind: "sep" },
    ...dayItem("Today", todayISO(now)),
    ...dayItem("Tomorrow", tomorrowISO()),
    ...dayItem("Next week", nextWeekISO()),
    ...(timed
      ? [{ kind: "action" as const, label: "Anytime that day", action: () => { mutations.unblock(task, TRIAGE_UNDO); onClose(); } }]
      : []),
    ...(onDate ? [{ kind: "action" as const, label: "When…", key: "T", action: () => { onClose(); onDate(); } }] : []),
    ...(onSchedule ? [{ kind: "action" as const, label: "Pick a time…", action: onSchedule }] : []),
    { kind: "sep" },
    ...(onMove ? [{ kind: "action" as const, label: "Move to…", key: "V", action: () => { onClose(); onMove(); } }] : []),
    ...(task.status !== "inbox"
      ? [{
          kind: "action" as const,
          // Say where it lands: project work rests in its project, not the Inbox.
          label: task.project_id ? "Back to its project" : "Return to inbox",
          action: () => { mutations.backToInbox(task, TRIAGE_UNDO); onClose(); },
        }]
      : []),
    ...(task.status === "inbox" && (task.project_id || task.initiative_id || task.domain_id)
      ? [{ kind: "action" as const, label: "File to project", action: () => { mutations.fileToProject(task); onClose(); } }]
      : []),
    {
      kind: "action",
      label: inWeek ? "Remove from week" : "Commit to this week",
      action: () => { commitToWeek(task); onClose(); },
    },
    ...(onDuplicate || onToEvent || onLabel ? [{ kind: "sep" as const }] : []),
    ...(onDuplicate ? [{ kind: "action" as const, label: "Duplicate", action: () => { onDuplicate(); onClose(); } }] : []),
    ...(onToEvent ? [{ kind: "action" as const, label: onToEvent.label, action: onToEvent.action }] : []),
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
          action: () => { mutations.trash(task); onClose(); },
        },
  ];

  const actions = items.filter((i): i is Extract<Item, { kind: "action" }> => i.kind === "action");
  const live = useRef({ actions, lit, deleteMode, recurring });
  live.current = { actions, lit, deleteMode, recurring };
  useEffect(() => setLit(-1), [deleteMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { actions, lit, deleteMode, recurring } = live.current;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        if (deleteMode && !startInDelete) setDeleteMode(false);
        else onClose();
        return;
      }
      if (isTypingIn(e.target)) return;
      const spend = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === "Backspace" || e.key === "Delete") {
        spend();
        // A series asks which occurrences, from the keyboard exactly as from
        // the click — ⌫ used to trash one row and leave the series' scope unasked.
        if (recurring && !deleteMode) setDeleteMode(true);
        else if (!deleteMode) { mutations.trash(task); onClose(); }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        spend();
        const n = actions.length;
        if (!n) return;
        setLit(e.key === "ArrowDown" ? (lit + 1 + n) % n : (lit - 1 + n) % n);
        return;
      }
      if (e.key === "Enter") {
        spend();
        (actions[lit] ?? actions[0])?.action();
        return;
      }
      // The printed hints: E · T · V · # · ⌘E.
      const hint = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e"
        ? "⌘E"
        : !e.metaKey && !e.ctrlKey && !e.altKey ? e.key.toUpperCase() : null;
      const hit = hint ? actions.find((a) => a.key === hint) : undefined;
      if (hit) {
        spend();
        hit.action();
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
  }, [onClose, task, mutations, startInDelete]);

  let actionIndex = -1;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={task.title}
      data-nested-surface=""
      className="rise elev-3 fixed z-[70] w-[224px] overflow-y-auto rounded-[var(--radius)] border border-line bg-surface py-1"
      // Client px measured, CSS px placed — under UI zoom the two differ, and the
      // calendar's block menu (which now IS this menu) had always corrected it.
      style={{ top: fixedCssPx(pos.top), left: fixedCssPx(pos.left), maxHeight: "calc(100vh - 16px)" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Whose menu this is — on a narrow calendar block it's the only place
          the full title shows, and every calendar menu already led with it. */}
      <div className="truncate border-b border-line px-3 pb-1.5 pt-0.5 text-meta text-muted">{task.title}</div>
      {items.map((item, i) => {
        if (item.kind === "sep") {
          // Leading, trailing and doubled rules come from optional items.
          const prev = items[i - 1];
          if (i === 0 || i === items.length - 1 || prev?.kind === "sep") return null;
          return <div key={i} className="my-1 border-t border-line" />;
        }
        if (item.kind === "label")
          return (
            <div key={i} className="mono px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted">
              {item.label}
            </div>
          );
        actionIndex += 1;
        const on = actionIndex === lit;
        const idx = actionIndex;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            onMouseEnter={() => setLit(idx)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              item.action();
            }}
            // Destructive in ink at rest, `--danger` when lit (D-101) — not
            // `--signal`, which on this screen means "now".
            className={`fast flex min-h-7 w-full items-center gap-2 px-3 py-1.5 text-left text-caption ${
              on ? "bg-bg" : ""
            } ${item.danger && on ? "text-danger" : "text-text"}`}
          >
            <span className="flex-1 truncate">{item.label}</span>
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
