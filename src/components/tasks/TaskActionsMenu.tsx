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

import type { IconName } from "../Icon";
import { Kbd } from "../kit";
import { PopIcon, keycaps as shortcutLabel, type PopGlyphName } from "../PopoverParts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { useUnschedule } from "../../hooks/useUnschedule";
import { isUnschedulable } from "../../lib/unschedule";
import { Input } from "../kit";
import { agentName, useHandoffActs, useHandoffAgents, type HandoffAgent } from "../../hooks/useHandoff";
import { isHandedOff } from "../../../supabase/functions/_shared/handoff";

type Mutations = ReturnType<typeof useTaskMutations>;
const TRIAGE_UNDO = { undo: "toast" as const };
type UndoOpts = Parameters<Mutations["planFor"]>[2];

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

type RecurrenceMutations = ReturnType<typeof useRecurrenceMutations>;
type Recurrence = NonNullable<ReturnType<typeof useRecurrences>["data"]>[number];

/** Trash a repeating task's occurrence, the rest of the series from it, or the
 *  whole series — one meaning for the desktop's menu and the phone's sheet. */
export function trashTaskScoped(
  mutations: Mutations,
  recurrenceMutations: RecurrenceMutations,
  recurrence: Recurrence | null,
  task: Task,
  scope: "THIS" | "FOLLOWING" | "ALL",
  opts?: Parameters<Mutations["trash"]>[1],
) {
  if (scope === "THIS") {
    if (recurrence && task.recurrence_date) recurrenceMutations.skipOccurrence(recurrence, task.recurrence_date);
    mutations.trash(task, opts);
  } else if (scope === "FOLLOWING") {
    if (recurrence && task.do_date) recurrenceMutations.deleteFollowing(recurrence, task.do_date);
  } else if (recurrence) {
    recurrenceMutations.deleteSeries(recurrence);
  }
}

/** Trash from a list, a key or the bulk bar. A repeating task's occurrence is
 *  also skipped — plain trash let the series stamp it straight back — exactly
 *  the calendar's and the phone's "This event" (`trashTaskScoped`). */
export function useTrashTask(mutations: Mutations) {
  const { data: recurrences } = useRecurrences();
  const recurrenceMutations = useRecurrenceMutations();
  return useCallback(
    (task: Task, opts?: Parameters<Mutations["trash"]>[1]) => {
      const recurrence = task.recurrence_id ? (recurrences?.find((r) => r.id === task.recurrence_id) ?? null) : null;
      trashTaskScoped(mutations, recurrenceMutations, recurrence, task, "THIS", opts);
    },
    [mutations, recurrenceMutations, recurrences],
  );
}

/** Move a task to a day by hand. A timed task keeps its clock; an untimed one
 *  is planned for the day, as before. */
export function moveToDay(mutations: Mutations, task: Task, dateISO: string, opts: UndoOpts = TRIAGE_UNDO) {
  const start = sameClockOn(task, dateISO);
  if (start) mutations.block(task, start, task.duration_minutes ?? undefined, opts);
  else mutations.planFor(task, dateISO, opts);
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
  onFocus,
  group,
  onUnscheduleGroup,
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
  /** ⌘. — narrow the rail to this task (or the selection it's in), D-242.
   *  Only hosts whose task the rail can hold today offer it. */
  onFocus?: { label: string; action: () => void };
  /** The menu opened on a row inside a selection of several: the day acts,
   *  Mark done, Unschedule and Trash reach every task in it, and what only
   *  makes sense for one task (Open, Rename, Duplicate…) steps aside (D-248).
   *  `task` is still the row pointed at; `group` includes it. */
  group?: readonly Task[];
  /** The host's Unschedule for the whole selection, when it holds more than
   *  tasks (the calendar's slots and events). Without it, the group's tasks. */
  onUnscheduleGroup?: () => void;
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

  const unschedule = useUnschedule(mutations);
  // Hand-off (D-250): offered only for agents this account has added.
  const { data: agents = [] } = useHandoffAgents();
  const handoff = useHandoffActs();
  const [handingTo, setHandingTo] = useState<HandoffAgent | null>(null);
  const [handNote, setHandNote] = useState("");
  const many = group && group.length > 1 ? group : null;
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
    | { kind: "action"; label: string; key?: string; icon?: IconName | PopGlyphName; danger?: boolean; action: () => void }
    | { kind: "sep" }
    | { kind: "label"; label: string };

  const deleteItems: Item[] = [
    { kind: "label", label: "Delete" },
    {
      kind: "action",
      label: "This occurrence",
      action: () => {
        trashTaskScoped(mutations, recurrenceMutations, recurrence, task, "THIS");
        onClose();
      },
    },
    {
      kind: "action",
      label: "This & following",
      action: () => {
        trashTaskScoped(mutations, recurrenceMutations, recurrence, task, "FOLLOWING");
        onClose();
      },
    },
    {
      kind: "action",
      label: "Whole series",
      action: () => {
        trashTaskScoped(mutations, recurrenceMutations, recurrence, task, "ALL");
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
          icon: dateISO === todayISO(now) ? "sun" : "calendar",
          action: () => { moveToDay(mutations, task, dateISO); onClose(); },
        }];

  // ── Several tasks at once (D-248) ─────────────────────────────────────
  // One coalesce key per open menu, so a day act over the selection is ONE
  // undo whether each row moved by its clock (`block`) or by its day (`planFor`).
  const groupUndo = useRef({ undo: "toast" as const, coalesceKey: `group:${Math.random().toString(36).slice(2)}` }).current;
  const groupRecurring = Boolean(many?.some((t) => t.recurrence_id));
  const groupOpen = many?.filter((t) => t.status !== "done" && t.status !== "trashed") ?? [];
  const groupDay = (label: string, dateISO: string): Item[] => {
    const moving = groupOpen.filter((t) => t.do_date !== dateISO);
    return moving.length
      ? [{
          kind: "action",
          label,
          icon: dateISO === todayISO(now) ? "sun" : "calendar",
          action: () => { moving.forEach((t) => moveToDay(mutations, t, dateISO, groupUndo)); onClose(); },
        }]
      : [];
  };
  const groupTimed = groupOpen.filter((t) => t.start_time);
  const groupItems: Item[] = many
    ? [
        ...(onMakeSlot
          ? [
              { kind: "action" as const, label: "Make one slot", key: "⌘G", icon: "duration" as const, action: () => { onClose(); onMakeSlot(); } },
              { kind: "sep" as const },
            ]
          : []),
        ...(groupOpen.length
          ? [{
              kind: "action" as const, label: "Mark done", key: "E", icon: "check" as const,
              action: () => { groupOpen.forEach((t) => mutations.complete(t, groupUndo)); onClose(); },
            }]
          : []),
        { kind: "sep" },
        ...groupDay("Today", todayISO(now)),
        ...groupDay("Tomorrow", tomorrowISO()),
        ...groupDay("Next week", nextWeekISO()),
        ...(groupTimed.length
          ? [{
              kind: "action" as const, label: "Anytime that day", icon: "clock" as const,
              action: () => { groupTimed.forEach((t) => mutations.unblock(t, groupUndo)); onClose(); },
            }]
          : []),
        ...(onDate ? [{ kind: "action" as const, label: "When…", key: "T", icon: "calendar" as const, action: () => { onClose(); onDate(); } }] : []),
        { kind: "sep" },
        ...(onMove ? [{ kind: "action" as const, label: "Move to…", key: "V", icon: "arrow-right" as const, action: () => { onClose(); onMove(); } }] : []),
        ...(many.some(isUnschedulable)
          ? [{
              kind: "action" as const, label: "Unschedule", key: "U", icon: "inbox" as const,
              action: () => { if (onUnscheduleGroup) onUnscheduleGroup(); else unschedule(many); onClose(); },
            }]
          : []),
        // A series asks which occurrences, one question each — never decided in
        // bulk (D-158). With one in the selection, ⌫ on the grid asks them.
        ...(!groupRecurring
          ? [
              { kind: "sep" as const },
              {
                kind: "action" as const, label: "Trash", key: "⌫", icon: "trash" as const, danger: true,
                action: () => { many.forEach((t) => mutations.trash(t, groupUndo)); onClose(); },
              },
            ]
          : []),
      ]
    : [];

  // With an agent: one way back. Not with one: one item per agent. A step,
  // a done task and an account with no agents get nothing.
  function handItems(): Item[] {
    if (many || task.parent_task_id || task.status === "trashed") return [];
    if (isHandedOff(task)) {
      const who = agentName(agents, task.handed_to);
      const agent = agents.find((a) => a.id === task.handed_to) ?? null;
      return [
        { kind: "sep" },
        { kind: "action", label: `Take back from ${who}`, icon: "back", action: () => { void handoff.recall(task, agent); onClose(); } },
      ];
    }
    if (done || !agents.length) return [];
    return [
      { kind: "sep" },
      ...agents.map((a) => ({
        kind: "action" as const,
        label: `Hand to ${a.name}…`,
        icon: "user" as const,
        action: () => { setHandNote(""); setHandingTo(a); },
      })),
    ];
  }

  const items: Item[] = many
    ? groupItems
    : deleteMode && recurring
    ? deleteItems
    : [
    ...(onMakeSlot
      ? [
          { kind: "action" as const, label: "Make one slot", key: "⌘G", icon: "duration" as const, action: () => { onClose(); onMakeSlot(); } },
          { kind: "sep" as const },
        ]
      : []),
    {
      kind: "action", label: "Open", key: "↵", icon: "arrow-right" as const,
      action: () => {
        const el = document.querySelector<HTMLElement>(`[data-task-drag="${task.id}"]`);
        onOpen(el?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40));
      },
    },
    ...(onRename ? [{ kind: "action" as const, label: "Rename", key: "⌘E", icon: "pen" as const, action: () => { onClose(); onRename(); } }] : []),
    {
      kind: "action",
      label: done ? "Reopen" : "Mark done",
      key: "E",
      icon: done ? ("refresh" as const) : ("check" as const),
      action: () => { toggleDone(); onClose(); },
    },
    ...(onFocus && !done
      ? [{ kind: "action" as const, label: onFocus.label, key: "⌘.", icon: "focus" as const, action: () => { onClose(); onFocus.action(); } }]
      : []),
    { kind: "sep" },
    ...dayItem("Today", todayISO(now)),
    ...dayItem("Tomorrow", tomorrowISO()),
    ...dayItem("Next week", nextWeekISO()),
    ...(timed
      ? [{ kind: "action" as const, label: "Anytime that day", icon: "clock" as const, action: () => { mutations.unblock(task, TRIAGE_UNDO); onClose(); } }]
      : []),
    ...(onDate ? [{ kind: "action" as const, label: "When…", key: "T", icon: "calendar" as const, action: () => { onClose(); onDate(); } }] : []),
    ...(onSchedule ? [{ kind: "action" as const, label: "Pick a time…", icon: "clock" as const, action: onSchedule }] : []),
    { kind: "sep" },
    ...(onMove ? [{ kind: "action" as const, label: "Move to…", key: "V", icon: "arrow-right" as const, action: () => { onClose(); onMove(); } }] : []),
    // Off the calendar: loose work to the Inbox, project work to its project
    // (D-063a's routing) — the toast names which (D-248).
    ...(isUnschedulable(task)
      ? [{
          kind: "action" as const,
          label: "Unschedule",
          key: "U",
          icon: task.project_id ? ("folder" as const) : ("inbox" as const),
          action: () => { unschedule([task]); onClose(); },
        }]
      : []),
    ...(task.status === "inbox" && (task.project_id || task.initiative_id || task.domain_id)
      ? [{ kind: "action" as const, label: "File to project", icon: "folder" as const, action: () => { mutations.fileToProject(task); onClose(); } }]
      : []),
    {
      kind: "action",
      label: inWeek ? "Remove from week" : "Commit to this week",
      icon: "week",
      action: () => { commitToWeek(task); onClose(); },
    },
    ...handItems(),
    ...(onDuplicate || onToEvent || onLabel ? [{ kind: "sep" as const }] : []),
    ...(onDuplicate ? [{ kind: "action" as const, label: "Duplicate", icon: "copy" as const, action: () => { onDuplicate(); onClose(); } }] : []),
    ...(onToEvent ? [{ kind: "action" as const, label: onToEvent.label, icon: "calendar" as const, action: onToEvent.action }] : []),
    ...(onLabel ? [{ kind: "action" as const, label: "Label…", key: "#", icon: "tag" as const, action: onLabel }] : []),
    { kind: "sep" },
    recurring
      ? {
          kind: "action" as const,
          label: "Trash…",
          key: "⌫",
          icon: "trash" as const,
          danger: true,
          action: () => setDeleteMode(true),
        }
      : {
          kind: "action" as const,
          label: "Trash",
          key: "⌫",
          icon: "trash" as const,
          danger: true,
          action: () => { mutations.trash(task); onClose(); },
        },
  ];

  const actions = items.filter((i): i is Extract<Item, { kind: "action" }> => i.kind === "action");
  const live = useRef({ actions, lit, deleteMode, recurring, many, handing: Boolean(handingTo) });
  live.current = { actions, lit, deleteMode, recurring, many, handing: Boolean(handingTo) };
  useEffect(() => setLit(-1), [deleteMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { actions, lit, deleteMode, recurring, many, handing } = live.current;
      if (handing) {
        if (e.key === "Escape") {
          e.stopImmediatePropagation();
          setHandingTo(null);
        }
        return;
      }
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
        // A selection trashes as the item does — and not at all with a series
        // in it (that's a question per series, asked from the grid's ⌫).
        if (many) {
          actions.find((a) => a.key === "⌫")?.action();
          return;
        }
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
      // The printed hints: E · T · V · # · ⌘E · ⌘.
      const hint = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e"
        ? "⌘E"
        : (e.metaKey || e.ctrlKey) && e.key === "."
          ? "⌘."
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
      aria-label={many ? `${many.length} tasks` : task.title}
      data-nested-surface=""
      className="k-pop"
      // Client px measured, CSS px placed — under UI zoom the two differ, and the
      // calendar's block menu (which now IS this menu) had always corrected it.
      style={{ top: fixedCssPx(pos.top), left: fixedCssPx(pos.left), width: 240, maxHeight: "calc(100vh - 16px)", zIndex: 70 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Whose menu this is — on a narrow calendar block it's the only place
          the full title shows, and every calendar menu already led with it. */}
      <div className="k-mtitle">{many ? `${many.length} tasks` : task.title}</div>
      {handingTo ? (
        <form
          className="px-2 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handoff.hand(task, handingTo, handNote);
            onClose();
          }}
        >
          <Input
            autoFocus
            size="sm"
            value={handNote}
            onChange={(e) => setHandNote(e.target.value)}
            placeholder={`A line for ${handingTo.name}`}
            aria-label={`Note for ${handingTo.name}`}
            trailing={<Kbd keys={["↵"]} />}
          />
          <button type="submit" className="k-mi mt-1" data-lit="">
            <PopIcon name="user" />
            <span className="k-mi-label">Hand to {handingTo.name}</span>
          </button>
        </form>
      ) : items.map((item, i) => {
        if (item.kind === "sep") {
          // Leading, trailing and doubled rules come from optional items.
          const prev = items[i - 1];
          if (i === 0 || i === items.length - 1 || prev?.kind === "sep") return null;
          return <div key={i} className="k-msep" role="separator" />;
        }
        if (item.kind === "label") return <div key={i} className="k-mlabel">{item.label}</div>;
        actionIndex += 1;
        const on = actionIndex === lit;
        const idx = actionIndex;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onMouseEnter={() => setLit(idx)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              item.action();
            }}
            className="k-mi"
            data-lit={on || undefined}
            // Destructive in `--danger` — not `--signal`, which means "now".
            data-danger={item.danger || undefined}
          >
            {item.icon ? <PopIcon name={item.icon} /> : <span className="k-mi-ico" aria-hidden />}
            <span className="k-mi-label">{item.label}</span>
            {item.key && <Kbd keys={shortcutLabel(item.key)} />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
