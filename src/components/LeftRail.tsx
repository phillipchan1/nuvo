import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { Label, Task } from "../lib/types";
import { isOverdue, nextWeekISO, todayISO } from "../lib/dates";
import { acceptPatch, dismissPatch } from "../lib/grooming";
import { TRASH_LIMIT, TRASH_RETENTION_DAYS, useTrashedTasks, type useTaskMutations } from "../hooks/useTasks";
import TaskComposer, { type TaskComposerHandle } from "./tasks/TaskComposer";
import TaskActionsMenu from "./tasks/TaskActionsMenu";
import { TaskDateMenu, TaskMoveMenu, usePriorityAct, useRenameAct } from "./tasks/TaskMenus";
import { orderBeside, useTaskListKeys } from "./tasks/useTaskListKeys";
import { restoreFromTrashPatch } from "../lib/types";
import { useVertical } from "../hooks/useVertical";
import { useTaskFilter } from "../hooks/useTaskFilter";
import TaskFilter from "./TaskFilter";
import BulkBar from "./BulkBar";
import { useBulkOps } from "../hooks/useBulkOps";
import { describeQuery, queryFacetCount } from "../lib/taskFilter";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useListReorder } from "../hooks/useListReorder";
import { announce } from "../lib/announce";
import { pressable } from "../lib/a11y";
import { domainById, initiativeById, projectById, taskDomainColor, taskDomainId, taskInitiativeId } from "../lib/vertical";
import ReminderSelect from "./ReminderSelect";
import type { ReminderAnchorKind } from "../../supabase/functions/_shared/reminderRules.ts";
import TaskRow, { type TaskMeta, type TaskRowHandle } from "./TaskRow";
import WeekPanel, { type WeekDoor } from "./WeekPanel";
import { InboxAddressHint } from "./InboxAddress";
import { SectionLabel } from "./ui";
import { skipWhenAsleep } from "./KeepAlive";

/**
 * The rail's faces. `trash` is the floor under delete (audit rank 8: a trashed
 * task was unrecoverable once its six-second toast expired). It is deliberately
 * NOT a sixth navigation destination — Principle 10 — and not a peer of Today
 * and Inbox either (D-136): an icon on the strip that already exists, shown
 * only when it holds something.
 */
export type RailTab = "inbox" | "today" | "trash";
type Mutations = ReturnType<typeof useTaskMutations>;

/** Keyboard / menu / tab-drop triage: destination may vanish from the rail, so
 *  these plan/return acts take the toast channel (complete/trash already do). */
const TRIAGE_UNDO = { undo: "toast" as const };

const RAIL_WIDTH_KEY = "nuvo-rail-width";
const DEFAULT_RAIL_WIDTH = 360;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 560;

function readRailWidth(): number {
  try {
    const v = Number(localStorage.getItem(RAIL_WIDTH_KEY));
    if (Number.isFinite(v) && v >= MIN_RAIL_WIDTH && v <= MAX_RAIL_WIDTH) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_RAIL_WIDTH;
}

function writeRailWidth(width: number) {
  try {
    localStorage.setItem(RAIL_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

function LeftRail({
  tab,
  setTab,
  inbox,
  today,
  labels,
  mutations,
  onOpenTask,
  hotkeysEnabled,
  now,
  railRef,
  collapsed = false,
  squeezed = false,
  weekDoor,
}: {
  tab: RailTab;
  setTab: (t: RailTab) => void;
  inbox: Task[];
  today: Task[];
  labels: Label[];
  mutations: Mutations;
  onOpenTask: (t: Task, anchor: DOMRect) => void;
  hotkeysEnabled: boolean;
  /** False while a floor covers the Schedule — skip reconciling the rail. */
  live?: boolean;
  now: Date;
  railRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Focus mode: slide the rail closed so the calendar takes the whole width. */
  collapsed?: boolean;
  /**
   * Squeeze mode: the chat is open on a narrow window, so give the calendar
   * back everything above the rail's own minimum. Clamps the *rendered* width
   * only — the user's dragged preference is untouched and springs back when
   * the squeeze lifts. MIN_RAIL_WIDTH is a width they can already drag to, so
   * this never shows a size the rail wasn't designed for.
   */
  squeezed?: boolean;
  /** The week door's lifecycle, worn by the WeekPanel header that crowns us. */
  weekDoor?: WeekDoor;
}) {
  const { data: vertical } = useVertical();
  const { nav } = useAppNavigation();

  /** A task's thread back up the vertical: its domain color. */
  const accentOf = (t: Task) => taskDomainColor(vertical, t);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The pivot for shift-click range selection — the last row touched plainly
  // or cmd-toggled. Range runs from here to the shift-clicked row.
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ task: Task; x: number; y: number } | null>(null);
  // `t` / `v` — the shared when / move menus, beside the row they act on.
  const [rowMenu, setRowMenu] = useState<{ kind: "date" | "move"; targets: Task[]; anchor: DOMRect } | null>(null);
  // ⌘E — the row whose title is a field right now.
  const [editingId, setEditingId] = useState<string | null>(null);
  // The cursor is drawn only while the keyboard is driving it. A click selects
  // without lifting (the lift means "this row's popover is open", below).
  const [keyCursor, setKeyCursor] = useState(false);
  const [labelPickerFor, setLabelPickerFor] = useState<Task | null>(null);
  const [remindPickerFor, setRemindPickerFor] = useState<Task | null>(null);
  const [schedulePickerFor, setSchedulePickerFor] = useState<Task | null>(null);
  const captureRef = useRef<TaskComposerHandle>(null);
  // So keyboard completion can run the row's own bloom-and-collapse animation
  // (`triggerToggle`) instead of flipping `status` straight in the cache —
  // that instant flip is what made a keyboard-completed row just vanish.
  const rowHandles = useRef<Map<string, TaskRowHandle>>(new Map());
  const [railWidthPref, setRailWidth] = useState(readRailWidth);
  // What renders. Differs from the preference only while squeezed.
  const railWidth = squeezed ? Math.min(railWidthPref, MIN_RAIL_WIDTH) : railWidthPref;
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Done starts collapsed — it's the quiet tail, a single line until you want it
  // (the Loose-ends pattern). The active day work is one flat list, not sections.
  const [todayOpen, setTodayOpen] = useState({ done: false });
  const toggleToday = (key: keyof typeof todayOpen) =>
    setTodayOpen((s) => ({ ...s, [key]: !s[key] }));

  // Dismiss rail micro-overlays when navigation changes (incl. browser back).
  useEffect(() => {
    setContextMenu(null);
    setLabelPickerFor(null);
    setSchedulePickerFor(null);
    setRemindPickerFor(null);
  }, [nav]);

  // Glass-lift is "this row's popover is open", not the keyboard cursor.
  // selectedId still drives j/k and hotkeys; it used to also paint the
  // lift, which is how Escape (same closeOverlay as a click-away, just
  // without a blur) left a row lit after the panel was gone. Overlay is
  // the bit that mounts the popover, so they appear and vanish in one
  // paint — blur, Escape, and ✕ don't need their own notify.
  const openTaskId =
    nav.overlay === "task" || nav.overlay === "task-record" ? nav.overlayId : null;

  // Filters (audit rank 6). The question is held here, not persisted — a filter
  // left on from last Tuesday, quietly hiding work, is the failure mode every
  // list tool has, and in a planner a short list reads as "you're on top of it".
  // Saved views are the thing that persists; applying one is a deliberate act.
  const filter = useTaskFilter(now);
  const [filterOpen, setFilterOpen] = useState(false);
  const { apply: applyFilter } = filter;
  const filtering = queryFacetCount(filter.query) > 0;

  const todaySections = useMemo(() => {
    const s = buildTodaySections(today, now);
    if (!filtering) return s;
    return {
      ...s,
      pinned: applyFilter(s.pinned),
      unblocked: applyFilter(s.unblocked),
      scheduled: applyFilter(s.scheduled),
      done: applyFilter(s.done),
    };
  }, [today, now, applyFilter, filtering]);
  // The inbox is a hand-ordered queue, so it renders by sort_order rather than
  // by whatever the cache happens to hold — an optimistic reorder patches rows
  // in place without re-sorting them, so without this the drop wouldn't show
  // until the refetch landed.
  const inboxOrdered = useMemo(() => {
    const ordered = [...inbox].sort((a, b) => a.sort_order - b.sort_order);
    return filtering ? applyFilter(ordered) : ordered;
  }, [inbox, applyFilter, filtering]);

  // The trash — its own query, because every other read deliberately excludes
  // `status = "trashed"`. Empty until something is deleted, and the tab that
  // reveals it appears only then.
  const { data: trashedRows } = useTrashedTasks();
  const trashed = useMemo(() => trashedRows ?? [], [trashedRows]);

  // The tab can vanish under the user (restore the last row, empty the trash),
  // and a rail left on a face that no longer exists renders nothing at all.
  // Restore navigates itself (to Inbox when that's where the row landed); this
  // is the fallback for Empty trash / purge-all, which have nowhere better.
  useEffect(() => {
    if (tab === "trash" && trashed.length === 0) setTab("today");
  }, [tab, trashed.length, setTab]);

  // A release over a tab is a *drop*, not a navigation. pointerup clears
  // `draggingId` before the synthetic click fires, so without this latch a
  // drop aimed near Trash (which used to arm as if it were a destination)
  // would flip the strip to Trash and make the row look like it was deleted.
  const suppressTabClickRef = useRef(false);

  const visible: Task[] =
    tab === "inbox"
      ? inboxOrdered
      : tab === "trash"
        ? trashed
        : [...todaySections.pinned, ...todaySections.unblocked, ...todaySections.scheduled, ...todaySections.done];

  // The bulk bar's acts, shared with the phone (useBulkOps) so "move these to a
  // project" means the same thing on both — including carrying the initiative
  // and domain with it (D-088), and taking ONE undo entry for the whole set.
  const bulkOps = useBulkOps({
    selected: visible.filter((t) => selectedIds.has(t.id)),
    mutations,
    clear: () => setSelectedIds(new Set()),
  });


  const metaOf = (t: Task): TaskMeta => {
    const project = projectById(vertical, t.project_id);
    const initiative = initiativeById(vertical, taskInitiativeId(vertical, t));
    const domain = domainById(vertical, taskDomainId(vertical, t));
    return {
      project: project?.name ?? null,
      initiative: initiative?.name ?? null,
      domain: domain?.name ?? null,
      domainColor: domain?.color ?? null,
    };
  };

  const toggleMultiSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setSelectedId(id);
    setAnchorId(id);
  };

  // Shift-click: select every row between the anchor and this one, inclusive.
  const selectRangeTo = (id: string) => {
    const ids = visible.map((t) => t.id);
    const from = anchorId && ids.includes(anchorId) ? ids.indexOf(anchorId) : ids.indexOf(id);
    const to = ids.indexOf(id);
    if (from === -1 || to === -1) return;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    setSelectedIds(new Set(ids.slice(lo, hi + 1)));
    setSelectedId(id);
    // anchor stays put, so you can re-shift-click to grow/shrink the range
  };

  const plainSelect = (id: string) => {
    setSelectedId(id);
    setAnchorId(id);
    setKeyCursor(false);
  };

  const openContextMenu = (t: Task, e: React.MouseEvent) => {
    // cmd/ctrl-click is multi-select, not a context-menu request (on macOS a
    // ctrl-click also fires contextmenu — don't let it hijack the toggle).
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ task: t, x: e.clientX, y: e.clientY });
    setSelectedId(t.id);
  };

  // When ≥2 rows are selected, every selected row carries the full group (in
  // list order) so dragging any one of them drops the whole set on the calendar.
  const dragGroupIds =
    selectedIds.size > 1 ? visible.filter((t) => selectedIds.has(t.id)).map((t) => t.id) : [];
  const dragGroupStr = dragGroupIds.length > 1 ? dragGroupIds.join(",") : undefined;

  // ── hand ordering ───────────────────────────────────────────────────────────
  // A row can only be dragged to a new place among rows whose order is actually
  // ours to set. The inbox is one free queue; inside the day, the "anytime" run
  // is free, and a slot's children are free *within their slot*. A row with a
  // real time on it is ordered by the clock — dropping it two rows up would
  // snap straight back, so it gets no insertion line here and moves on the
  // calendar instead.
  const bands = useMemo(() => {
    const of = new Map<string, string>();
    const ids = new Map<string, string[]>();
    const add = (id: string, band: string) => {
      of.set(id, band);
      ids.set(band, [...(ids.get(band) ?? []), id]);
    };
    if (tab === "inbox") inboxOrdered.forEach((t) => add(t.id, "inbox"));
    else {
      todaySections.unblocked.forEach((t) => add(t.id, "anytime"));
      todaySections.scheduled.forEach((t) => t.slot_id && add(t.id, `slot:${t.slot_id}`));
    }
    return { of, ids };
  }, [tab, inboxOrdered, todaySections]);

  const listRef = useRef<HTMLDivElement>(null);
  // A drag is a move, not a selection. Selection resolves on mousedown (so
  // modifier-clicks always register), which used to leave the row you merely
  // dragged sitting lifted afterwards — put the cursor back where it was.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const preDragSelection = useRef<string | null>(null);

  const byId = useMemo(() => new Map(visible.map((t) => [t.id, t])), [visible]);

  // ── the tab strip as a router ───────────────────────────────────────────────
  // During a drag the two tabs stop being *places* and become the two acts you
  // can perform on the row in hand: take it off the day, or put it on the day.
  // They're already in the layout and already carry the words, so arming them
  // costs no reflow and covers no rows.
  //
  // The destination is NAMED, not implied. `backToInbox` sends a parented task
  // to its project's backlog, not to the triage Inbox — so a row dropped on a
  // tab labelled "Inbox" could land somewhere the rail doesn't render, and
  // simply vanish. The chip says where it's actually going before you let go,
  // and the toast says where it went with an Undo.
  const homeOf = (t: Task) => {
    if (!t.project_id) return "Inbox";
    const p = projectById(vertical, t.project_id);
    return p?.name ? `${p.name} backlog` : "its project's backlog";
  };
  const dropActs: Record<string, { label: (t: Task) => string; run: (t: Task) => void }> = {
    inbox: {
      label: (t) => `↩ Back to ${homeOf(t)}`,
      run: (t) =>
        mutations.backToInbox(t, {
          undo: "toast",
          label: `${t.title} — ${homeOf(t)}`,
        }),
    },
    today: {
      label: () => "→ Onto today",
      run: (t) =>
        mutations.planFor(t, todayISO(now), {
          undo: "toast",
          label: `${t.title} — today`,
        }),
    },
  };

  const { draggingId, zone, moveBy } = useListReorder({
    containerRef: listRef,
    itemSelector: "[data-task-drag]",
    idAttr: "data-task-drag",
    bandOf: (id) => bands.of.get(id) ?? null,
    bandIds: (band) => bands.ids.get(band) ?? [],
    // A tab only offers itself when the act would change something: you can't
    // take an inbox row off the day, and a row already on the day is already there.
    // Geometry, not elementFromPoint: FullCalendar's drag mirror sits over the
    // strip and would steal the hit, so a drop aimed at Inbox would miss. Trash
    // is deliberately NOT a zone (D-104) — it is a face, not a destination.
    externalDropAt: (x, y) => {
      const inRect = (el: Element | null) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      };
      if (tab === "today" && inRect(document.querySelector("[data-inbox-tab]"))) return "inbox";
      if (tab === "inbox" && inRect(document.querySelector("[data-today-tab]"))) return "today";
      return null;
    },
    onExternalDrop: (key, id) => {
      const t = byId.get(id);
      const act = dropActs[key];
      if (!t || !act) return;
      // Mutation layer owns the toast + Undo (D-063a destination label above).
      act.run(t);
    },
    zoneLabel: (key, id) => dropActs[key]?.label(byId.get(id) ?? ({} as Task)) ?? "",
    onPointerDown: () => {
      preDragSelection.current = selectedIdRef.current;
    },
    onDragEnd: () => {
      // Latch through the synthetic click that follows pointerup.
      suppressTabClickRef.current = true;
      requestAnimationFrame(() => {
        suppressTabClickRef.current = false;
      });
      setSelectedId(preDragSelection.current);
      setSelectedIds(new Set());
    },
    onCommit: (_band, ids) => {
      // Only the moved rows are written, inside the band's own range —
      // sort_order is a global column, so a reorder here must not renumber
      // rows it can't see (see `orderPatches`).
      const pool = ids.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t));
      mutations.reorder(pool, ids);
    },
  });

  // ── The list's keys — the same grammar as every task list (useTaskListKeys)
  // plus the rail's own triage letters, its filter and its trash face.
  const rowRect = (id: string) =>
    document.querySelector<HTMLElement>(`[data-task-drag="${id}"]`)?.getBoundingClientRect() ??
    new DOMRect(360, 200, 0, 40);
  const setPriority = usePriorityAct(mutations);
  const renameTask = useRenameAct(mutations);
  const doneIds = new Set(todaySections.done.map((t) => t.id));
  useTaskListKeys({
    enabled: hotkeysEnabled && !rowMenu && !editingId && !contextMenu && !labelPickerFor && !schedulePickerFor && !remindPickerFor,
    // Only rows that are drawn: j past the last one should reach the capture
    // box, not walk into a collapsed "done" tail.
    rows: tab === "today" && !todayOpen.done ? visible.filter((t) => !doneIds.has(t.id)) : visible,
    cursor: {
      cursorId: selectedId,
      setCursorId: (id) => {
        setSelectedId(id);
        setKeyCursor(Boolean(id));
      },
      selectedIds,
      setSelectedIds,
    },
    acts: {
      open: (t) => onOpenTask(t, rowRect(t.id)),
      complete: (targets) =>
        targets.forEach((t) => {
          if (t.status === "done") return mutations.uncomplete(t);
          // The row's own bloom-then-collapse, not an instant flip.
          const handle = rowHandles.current.get(t.id);
          if (handle) handle.triggerToggle();
          else mutations.complete(t);
        }),
      trash: (targets) => {
        targets.forEach((t) => mutations.trash(t));
        setContextMenu(null);
      },
      date: (targets) => setRowMenu({ kind: "date", targets, anchor: rowRect(targets[0].id) }),
      move: (targets) => setRowMenu({ kind: "move", targets, anchor: rowRect(targets[0].id) }),
      priority: setPriority,
      rename: (t) => setEditingId(t.id),
      reorderBy: (t, delta) => {
        const moved = moveBy(t.id, delta);
        // Nothing moved: the row is at the end of its band, or its band won't
        // take a manual order (a time-blocked row is sorted by its clock). Say
        // so — silence reads as a dropped keystroke.
        announce(moved ? `${t.title}, position ${moved.index} of ${moved.total}` : "Can't move this row any further");
      },
      toComposer: () => captureRef.current?.focus(),
      add: (anchor, where) => {
        const band = anchor ? bands.of.get(anchor.id) : null;
        const peers = band ? (bands.ids.get(band) ?? []).map((id) => byId.get(id)).filter((x): x is Task => Boolean(x)) : [];
        const sortOrder = anchor && peers.length ? orderBeside(peers, anchor, where) : undefined;
        captureRef.current?.focus(
          anchor && sortOrder != null ? { sortOrder, label: `${where} “${anchor.title}”` } : undefined,
        );
      },
      extra: (e, targets) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        // The trash face: rows are already trashed — only restore and open apply.
        if (tab === "trash") {
          if (e.key === "u" && targets.length) {
            e.preventDefault();
            // Follow the last restored row, so emptying the trash doesn't dump
            // you on Today while the row landed in the Inbox.
            let face: "inbox" | "today" = "today";
            targets.forEach((t) => {
              face = restoreFromTrashPatch(t).face;
              mutations.restore(t);
            });
            setTab(face);
            setSelectedId(null);
            setSelectedIds(new Set());
            return true;
          }
          return ["e", "t", "v", "x", "1", "2", "3", "4", "Backspace", "Delete", "a", "A"].includes(e.key);
        }
        switch (e.key) {
          case "Escape":
            // Innermost first: a menu, then a selection (the hook's), then the
            // filter — the one state that can silently hide work.
            if (contextMenu) {
              setContextMenu(null);
              return true;
            }
            if (selectedIds.size === 0 && !selectedId && filtering) {
              filter.setQuery({});
              return true;
            }
            return false;
          case "/":
            e.preventDefault();
            setFilterOpen((v) => !v);
            return true;
          // Triage shortcuts the rail has always had. Bare s / w / d / m belong
          // to the Schedule, which is why next week is `n`.
          case "n":
            targets.forEach((t) => mutations.planFor(t, nextWeekISO(), TRIAGE_UNDO));
            return targets.length > 0;
          case "i":
            targets.filter((t) => t.status !== "inbox").forEach((t) => mutations.backToInbox(t, TRIAGE_UNDO));
            return targets.length > 0;
          case "r":
            if (targets.length !== 1) return false;
            setSchedulePickerFor(targets[0]);
            return true;
          case "#":
            if (targets.length !== 1) return false;
            e.preventDefault();
            setLabelPickerFor(targets[0]);
            return true;
          // `m` is the Schedule's Month, so Remind lives on `b` (bell).
          case "b":
            if (targets.length !== 1) return false;
            e.preventDefault();
            setRemindPickerFor(targets[0]);
            return true;
          // `c` was capture before `a` was; kept so the old habit still works.
          case "c":
            e.preventDefault();
            captureRef.current?.focus();
            return true;
        }
        return false;
      },
    },
  });

  const rowProps = (t: Task) => ({
    ref: (el: TaskRowHandle | null) => {
      if (el) rowHandles.current.set(t.id, el);
      else rowHandles.current.delete(t.id);
    },
    task: t,
    labels,
    // One clock for the row and the group that sorted it — see TaskRow's `now`.
    now,
    selected: t.id === openTaskId || (keyCursor && t.id === selectedId),
    editing: editingId === t.id,
    onRename: (title: string | null) => {
      setEditingId(null);
      if (title) renameTask(t, title);
    },
    multiSelected: selectedIds.has(t.id),
    draggable: true,
    dragging: draggingId === t.id,
    dragGroup: selectedIds.has(t.id) ? dragGroupStr : undefined,
    accent: accentOf(t),
    meta: metaOf(t),
    onSelect: () => plainSelect(t.id),
    onOpen: (anchor: DOMRect) => {
      setSelectedIds(new Set());
      onOpenTask(t, anchor);
    },
    onToggleDone: () => (t.status === "done" ? mutations.uncomplete(t) : mutations.complete(t)),
    onMultiToggle: () => toggleMultiSelect(t.id),
    onRangeSelect: () => selectRangeTo(t.id),
    onContextMenu: (e: React.MouseEvent) => openContextMenu(t, e),
    onAcceptSuggestion: () => mutations.patchTask(t.id, acceptPatch(t)),
    onDismissSuggestion: () => mutations.patchTask(t.id, dismissPatch(t)),
  });

  const tabCount = (t: "inbox" | "today") =>
    t === "inbox" ? inbox.length : today.filter((x) => x.status !== "done").length;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = railWidth;
    let latest = startW;
    const outer = e.currentTarget.parentElement?.parentElement as HTMLElement | null;
    const inner = e.currentTarget.parentElement as HTMLElement | null;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const paintWidth = (w: number) => {
      if (outer) outer.style.width = `${w}px`;
      if (inner) inner.style.width = `${w}px`;
    };

    const onMove = (ev: PointerEvent) => {
      latest = Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, startW + ev.clientX - startX));
      paintWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setRailWidth(latest);
      writeRailWidth(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={railRef}
      data-rail-drop
      data-drop-tab={tab}
      className="relative z-40 h-full shrink-0 overflow-hidden"
      style={{
        width: collapsed ? 0 : railWidth,
        transition: "width var(--d-slow) var(--ease-out)",
      }}
    >
      {/* Inner keeps its natural width so nothing reflows while the outer clips
          it shut in focus mode. Window drag is scoped to the titlebar strip +
          crown/tabs — the task list opts out so row drags aren't window drags. */}
      <div
        className="relative flex h-full flex-col border-r border-line"
        style={{
          width: railWidth,
          opacity: collapsed ? 0 : 1,
          transition: "opacity var(--d-base) var(--ease-out)",
        }}
      >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        data-tauri-drag-region="false"
        onPointerDown={startResize}
        // Hidden while squeezed as well as collapsed: the rendered width is
        // pinned to the minimum there, so a drag would grab the handle and
        // move nothing — a control that visibly does nothing is worse than an
        // absent one.
        className={`absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize touch-none hover:bg-accent/20 active:bg-accent/35 ${collapsed || squeezed ? "hidden" : ""}`}
      />
      {/* Clears macOS traffic lights — explicit drag target, not inherited from deep. */}
      <div data-tauri-drag-region className="rail-titlebar-drag w-full shrink-0" aria-hidden />
      <div data-tauri-drag-region="deep" className="shrink-0">
        {/* The week's plan — priorities held in view all week, crowning the rail.
            Its header is the week door ("Plan the week"). */}
        <WeekPanel
          door={weekDoor}
          // ONE task grammar (see WeekPanel's header): a project's work renders
          // through the same `TaskRow` — and the same wiring — as the day list
          // below. The rail owns selection, the context menu, opening a record
          // and complete/undo, so the crown borrows that rather than growing a
          // second copy of it, which is exactly how the two grammars happened.
          //
          // `ref` is dropped on purpose: a project task dated today appears in
          // BOTH the crown and the Today list (it is genuinely both), and the
          // handle map is keyed by task id — letting the crown register would
          // hand keyboard completion to whichever copy rendered last.
          //
          // `meta` is dropped too: inside a project's group the row's place is
          // what you opened to get here, so the place tag restated the parent's
          // name on every child — and cost each row a second line to do it.
          renderTask={(t, { action, draggable, dragData, whenShown }) => (
            <TaskRow
              key={t.id}
              {...rowProps(t)}
              ref={undefined}
              meta={undefined}
              draggable={draggable ?? false}
              action={action}
              whenShown={whenShown}
              dragData={dragData}
            />
          )}
        />
        {/* Tabs — Today and Inbox are the day's two faces. Trash is recovery,
            so it sits as an icon on the same strip rather than splitting the
            row three ways (D-136). The strip carries one continuous baseline
            so the active underline sits ON a line instead of floating between
            the crown's divider and nothing. */}
        <div className="flex border-b border-line">
          {(["today", "inbox"] as const).map((t) => {
            // Three states, because "you could drop here" and "you are about to"
            // are different promises: resting · armed (a compatible row is in
            // hand) · ready (the pointer is on it, release commits).
            // Only the tabs that are real drop acts arm — Trash is a face, not
            // a destination (D-104). Arming it next to Inbox made a drop aimed
            // at Inbox look like it might delete, and a release over Trash
            // flipped the strip there so the row appeared to vanish into it.
            const canDrop = t === "inbox" || t === "today";
            const armed = Boolean(draggingId) && canDrop && t !== tab;
            const ready = zone === t;
            return (
              <button
                key={t}
                onClick={() => {
                  if (suppressTabClickRef.current) return;
                  setTab(t);
                }}
                {...(t === "inbox"
                  ? { "data-inbox-tab": "", "data-teach": "inbox-tab" }
                  : { "data-today-tab": "" })}
                className={`fast -mb-px flex-1 border-b-2 px-3 py-2 text-caption font-semibold ${
                  tab === t ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
                } ${ready ? "rail-tab-ready" : armed ? "rail-tab-armed" : ""}`}
              >
                {t === "inbox" ? "Inbox" : "Today"}
                <span className="mono ml-1.5 text-meta text-muted">{tabCount(t)}</span>
              </button>
            );
          })}
          {trashed.length > 0 && (
            <button
              type="button"
              data-trash-tab=""
              aria-label={`Trash · ${trashed.length >= TRASH_LIMIT ? `${TRASH_LIMIT}+` : trashed.length}`}
              aria-pressed={tab === "trash"}
              title="Trash"
              onClick={() => {
                if (suppressTabClickRef.current) return;
                setTab("trash");
              }}
              className={`fast -mb-px flex shrink-0 items-center justify-center border-b-2 px-2.5 py-2 ${
                tab === "trash" ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
          {/* The filter lives ON the tab strip, not above it: it modifies which
              face you're looking at, and a control that floats free of the faces
              reads as a sixth destination. Inert on Trash — the trash is a
              recovery surface, and a filtered one could hide the row you came
              back for without saying so. */}
          {tab !== "trash" && (
            <div className="flex shrink-0 items-center pr-2">
              <TaskFilter
                query={filter.query}
                onChange={filter.setQuery}
                labels={labels}
                vertical={vertical}
                savedViews={filter.savedViews}
                onSaveView={filter.saveView}
                onDeleteView={filter.deleteView}
                onApplyView={filter.applyView}
                open={filterOpen}
                onOpenChange={setFilterOpen}
              />
            </div>
          )}
        </div>
      </div>

      {/* List — opt out of the titlebar drag region so row drags aren't window drags */}
      <div ref={listRef} className="rail-list relative min-h-0 flex-1 overflow-y-auto" data-tauri-drag-region="false" data-teach="day-list">
        {/* Where a released row will land. The list never reflows to show it —
            rows shifting under the cursor is what made the old drop chrome read
            as the list jumping away from you. The line node is owned by
            useListReorder and repainted imperatively per frame. */}
        {/* The "you're about to..." label itself is plain DOM, owned by
            useListReorder (`zoneLabel` above) — same idiom as the calendar's
            slot chip, and for the same reason: it repaints every pointermove,
            and routing that through React state re-rendered the whole rail. */}

        {tab === "inbox" && (
          <>
            {inboxOrdered.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
            {inboxOrdered.length === 0 && (
              // Never claim inbox zero over a filter. A short list reads as
              // "you're on top of it", which is the one lie a planner must not
              // tell — so a filtered empty says what it's hiding behind.
              filtering ? (
                <EmptyState
                  text={`Nothing in the inbox matches ${describeQuery(filter.query, { label: (id) => labels.find((l) => l.id === id)?.name, domain: (id) => vertical?.domains.find((d) => d.id === id)?.name })}.`}
                />
              ) : (
                <>
                  <EmptyState text="Inbox zero. Capture with A or ⌘K." />
                  <InboxAddressHint />
                </>
              )
            )}
          </>
        )}

        {tab === "trash" && (
          <TrashList
            tasks={trashed}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRestore={(t) => {
              // Navigate before the cache drops the last row — otherwise the
              // empty-trash effect parks you on Today while an inbox restore
              // sits somewhere you aren't looking.
              const { face } = restoreFromTrashPatch(t);
              mutations.restore(t);
              setTab(face);
              setSelectedId(null);
            }}
            onPurge={(t) => void mutations.purge(t)}
            onPurgeAll={() => void mutations.purgeAll(trashed)}
          />
        )}

        {tab === "today" && (
          <>
            {/* Overdue — the one group that earns a label, because its members
                need a *decision* while everything below needs execution. One
                muted word, the glossary's own term: it states a fact instead of
                addressing you ("Needs you" was an imperative, P4), and it lets
                the word come off every individual row.
                A label above an UNLABELED sibling list over-claims — it reads as
                covering everything below it. So the zone says how far it reaches
                twice, without a second word: the count beside the label, and a
                `--line-strong` closer (the last row inside loses its own hairline
                to `last:border-b-0`, so this is one line, not two). */}
            {todaySections.pinned.length > 0 && (
              <div className="border-b border-line-strong">
                <SectionLabel count={todaySections.pinned.length}>Overdue</SectionLabel>
                {todaySections.pinned.map((t) => (
                  <TaskRow key={t.id} {...rowProps(t)} />
                ))}
              </div>
            )}
            {/* The day's work, split by the one fact that says whether it will
                happen: does it have a time? The flat list leaned on the calendar
                beside it to answer that, and the calendar can't — it may be
                scrolled, on another week, or too narrow to read, and even when
                it's showing today you have to match titles across the gap to
                find the ones that AREN'T there. `TaskRow` renders no clock (its
                note above `durText`), so a timed row and a homeless one were
                pixel-identical. The work with no time comes first: it's the part
                of today that's still a wish (D-148). Same two labels as the
                phone's `MobileTaskList`. */}
            {todaySections.unblocked.length > 0 && (
              <div className={todaySections.scheduled.length > 0 ? "border-b border-line-strong" : undefined}>
                <SectionLabel count={todaySections.unblocked.length}>No time yet</SectionLabel>
                {todaySections.unblocked.map((t) => (
                  <TaskRow key={t.id} {...rowProps(t)} />
                ))}
              </div>
            )}
            {todaySections.scheduled.length > 0 && (
              <div>
                <SectionLabel count={todaySections.scheduled.length}>On the clock</SectionLabel>
                {todaySections.scheduled.map((t) => (
                  <TaskRow key={t.id} {...rowProps(t)} />
                ))}
              </div>
            )}
            {todaySections.pinned.length +
              todaySections.unblocked.length +
              todaySections.scheduled.length ===
              0 && (
              <div className="px-3 py-6 text-center text-caption text-muted">
                {filtering
                  ? "Nothing today matches the filter."
                  : "Nothing for today yet — capture below, or drag from the calendar."}
              </div>
            )}
            {/* Done — the quiet tail, folded to a single line (Loose-ends pattern). */}
            {todaySections.done.length > 0 && (
              // No border-t: the last active row's own border-b is already the
              // divider. Together they drew the double hairline under the list.
              <div>
                <button
                  onClick={() => toggleToday("done")}
                  className="fast tap flex w-full items-center gap-2 px-3 py-2 text-left"
                  aria-expanded={todayOpen.done}
                >
                  <span className="text-caption text-muted">{todaySections.done.length} done today</span>
                  <span className="ml-auto shrink-0 text-micro text-muted">{todayOpen.done ? "▾" : "▸"}</span>
                </button>
                {todayOpen.done &&
                  todaySections.done.map((t) => (
                    <TaskRow key={t.id} {...rowProps(t)} />
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Capture — floats at the foot of the rail as a pill, out of the
          hierarchy: it interrupts every mode, so it isn't a titled section (and
          mirrors the mobile ＋ FAB). Stays a real <input> so iOS dictation works
          (low-data-entry). Press A (or C) to focus. */}
      <div className="shrink-0 border-t border-line p-2.5" data-tauri-drag-region="false" data-teach="capture">
        <TaskComposer
          ref={captureRef}
          variant="pill"
          placeholder="Capture anything…"
          shortcut="A"
          context={tab === "today" ? { doDate: todayISO(now) } : undefined}
          contextLabel={tab === "today" ? { name: "Today" } : { name: "Inbox" }}
          onCreated={({ action }) => {
            setCaptureError(null);
            if (action.kind === "series" || action.input.do_date) setTab("today");
          }}
          onError={setCaptureError}
          onArrowUp={() => {
            // The last row that's actually drawn — a collapsed "done" tail isn't.
            const drawn = new Set(
              [...(listRef.current?.querySelectorAll<HTMLElement>("[data-task-drag]") ?? [])].map((el) => el.dataset.taskDrag),
            );
            const last = [...visible].reverse().find((t) => drawn.has(t.id));
            if (!last) return;
            setSelectedId(last.id);
            setKeyCursor(true);
          }}
        />
        {captureError && (
          <div className="mt-1 px-1 text-label text-signal">{captureError}</div>
        )}
      </div>

      {/* Bulk actions — one bar, shared with the phone (BulkBar.tsx). It grew
          label · priority · schedule · project-move here; the four it had
          before (today · inbox · done · trash) moved into it unchanged. */}
      {selectedIds.size > 1 && (
        <BulkBar count={selectedIds.size} ops={bulkOps} labels={labels} vertical={vertical} />
      )}

      {labelPickerFor && (
        <LabelPicker
          task={labelPickerFor}
          labels={labels}
          onClose={() => setLabelPickerFor(null)}
          onSet={(ids) => mutations.setLabels(labelPickerFor.id, ids)}
        />
      )}
      {schedulePickerFor && (
        <SchedulePicker
          task={schedulePickerFor}
          onClose={() => setSchedulePickerFor(null)}
          mutations={mutations}
        />
      )}
      {remindPickerFor && (
        <RemindPicker task={remindPickerFor} onClose={() => setRemindPickerFor(null)} />
      )}

      {contextMenu && (
        <TaskActionsMenu
          task={contextMenu.task}
          x={contextMenu.x}
          y={contextMenu.y}
          mutations={mutations}
          onSchedule={() => { setSchedulePickerFor(contextMenu.task); setContextMenu(null); }}
          onLabel={() => { setLabelPickerFor(contextMenu.task); setContextMenu(null); }}
          onDate={() => setRowMenu({ kind: "date", targets: [contextMenu.task], anchor: rowRect(contextMenu.task.id) })}
          onMove={() => setRowMenu({ kind: "move", targets: [contextMenu.task], anchor: rowRect(contextMenu.task.id) })}
          onRename={() => setEditingId(contextMenu.task.id)}
          onOpen={() => {
            const el = document.querySelector<HTMLElement>(`[data-task-drag="${contextMenu.task.id}"]`);
            const anchor = el?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40);
            onOpenTask(contextMenu.task, anchor);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
      {rowMenu?.kind === "date" && (
        <TaskDateMenu anchor={rowMenu.anchor} targets={rowMenu.targets} mutations={mutations} onClose={() => setRowMenu(null)} />
      )}
      {rowMenu?.kind === "move" && (
        <TaskMoveMenu anchor={rowMenu.anchor} targets={rowMenu.targets} mutations={mutations} onClose={() => setRowMenu(null)} />
      )}
      </div>
    </div>
  );
}

export default memo(LeftRail, skipWhenAsleep);

function EmptyState({ text }: { text: string }) {
  return <div className="px-3 py-6 text-center text-caption text-muted">{text}</div>;
}

// ── Right-click context menu ───────────────────────────────────────────────
function buildTodaySections(today: Task[], now: Date) {
  const active = today.filter((t) => t.status !== "done" && t.status !== "trashed");
  const done = today.filter((t) => t.status === "done");
  // Overdue ONLY. A rolled task dated today with no time on it isn't late — it's
  // today's plan, and folding it in here made the group's label lie (P6). Its ↻N
  // still rides the gutter, so the history survives where it belongs.
  const pinned = active
    .filter((t) => isOverdue(t, now))
    .sort((a, b) => b.roll_count - a.roll_count || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  const pinnedIds = new Set(pinned.map((t) => t.id));
  // Both runs sort by sort_order last so a hand reorder shows the instant it's
  // patched (patchTask updates rows in place; it doesn't re-sort the cache).
  // Scheduled rows are the clock's to order — sort_order only breaks ties, and
  // a tie inside one slot IS that slot's hand-set order.
  const unblocked = active
    .filter((t) => !t.start_time && !pinnedIds.has(t.id))
    .sort((a, b) => a.sort_order - b.sort_order);
  const scheduled = active
    .filter((t) => t.start_time && !pinnedIds.has(t.id))
    .sort(
      (a, b) =>
        a.start_time!.localeCompare(b.start_time!) ||
        (a.slot_id ?? "").localeCompare(b.slot_id ?? "") ||
        a.sort_order - b.sort_order,
    );
  return { pinned, unblocked, scheduled, done };
}

function LabelPicker({
  task,
  labels,
  onClose,
  onSet,
}: {
  task: Task;
  labels: Label[];
  onClose: () => void;
  onSet: (ids: string[]) => void;
}) {
  const current = new Set((task.task_labels ?? []).map((tl) => tl.label_id));
  return (
    <Popover onClose={onClose} title={`Labels — ${task.title}`}>
      {labels.length === 0 && (
        <div className="px-1 py-2 text-caption text-muted">No labels yet. Add them in Settings.</div>
      )}
      {labels.map((l) => (
        <label key={l.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-body hover:bg-bg">
          <input
            type="checkbox"
            defaultChecked={current.has(l.id)}
            onChange={(e) => {
              const next = new Set(current);
              e.target.checked ? next.add(l.id) : next.delete(l.id);
              onSet([...next]);
            }}
          />
          <span style={{ color: l.color }}>{l.name}</span>
        </label>
      ))}
    </Popover>
  );
}

/**
 * The trash.
 *
 * Hairline rows on the paper, not cards — nothing here floats (P14). Two acts
 * per row, and the destructive one asks: **Delete forever** is the only act in
 * the app with no undo, so it turns `--signal` only once it is confirming,
 * exactly as the popovers' footer does.
 *
 * Deliberately NOT a TaskRow: a trashed task has no checkbox, no drag handle,
 * no schedule chip and no context menu — every one of those would offer an act
 * that can't apply to something already deleted.
 */
function TrashList({
  tasks,
  selectedId,
  onSelect,
  onRestore,
  onPurge,
  onPurgeAll,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRestore: (t: Task) => void;
  onPurge: (t: Task) => void;
  onPurgeAll: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [emptyConfirm, setEmptyConfirm] = useState(false);

  if (tasks.length === 0) {
    return <EmptyState text="Nothing in the trash." />;
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2">
        <div className="min-w-0 text-meta leading-snug text-muted">
          Deleted tasks rest here. Restoring puts one back where it belongs; deleting forever
          can't be undone. Items older than {TRASH_RETENTION_DAYS} days are removed automatically.
        </div>
        <button
          type="button"
          onClick={() => {
            if (emptyConfirm) {
              onPurgeAll();
              setEmptyConfirm(false);
            } else {
              setEmptyConfirm(true);
            }
          }}
          onBlur={() => setEmptyConfirm(false)}
          className={`tap fast shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-label ${
            emptyConfirm ? "font-medium text-signal" : "text-muted hover:text-signal"
          }`}
        >
          {emptyConfirm ? "Delete all?" : "Empty trash"}
        </button>
      </div>
      {tasks.map((t) => {
        const isConfirming = confirming === t.id;
        return (
          <div
            key={t.id}
            data-task-id={t.id}
            onClick={() => onSelect(t.id)}
            {...pressable(() => onSelect(t.id), { role: "option", label: t.title || "Untitled" })}
            aria-selected={selectedId === t.id}
            className={`fast group flex items-center gap-2 border-b border-line px-4 py-2 ${
              selectedId === t.id ? "bg-accent-soft" : "hover:bg-surface-2"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-body text-muted">{t.title || "Untitled"}</div>
              {t.trashed_at && (
                <div className="mono text-micro text-muted/70">{deletedWhen(t.trashed_at)}</div>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRestore(t);
              }}
              className="tap fast shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-label text-muted hover:text-ink"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isConfirming) {
                  onPurge(t);
                  setConfirming(null);
                } else {
                  setConfirming(t.id);
                }
              }}
              onBlur={() => isConfirming && setConfirming(null)}
              className={`tap fast shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-label ${
                isConfirming ? "font-medium text-signal" : "text-muted hover:text-signal"
              }`}
            >
              {isConfirming ? "Sure?" : "Delete forever"}
            </button>
          </div>
        );
      })}
    </>
  );
}

/** "Deleted 2 hours ago" — the one fact a trash row owes you beyond its name. */
function deletedWhen(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "Deleted";
  if (mins < 1) return "Deleted just now";
  if (mins < 60) return `Deleted ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Deleted ${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Deleted yesterday" : `Deleted ${days}d ago`;
}

/**
 * Remind, from the keyboard (`b` on the focused row).
 *
 * Plain buttons rather than the popovers' `<select>` on purpose: this one is
 * reached by a key, so the leads have to be *visible* to be discoverable, and a
 * list of buttons is arrow/Tab-navigable with Enter to pick and Esc to leave —
 * no custom roving focus to get wrong.
 */
function RemindPicker({ task, onClose }: { task: Task; onClose: () => void }) {
  const anchor: ReminderAnchorKind = task.start_time || !task.deadline ? "start" : "deadline";
  const target = {
    targetKind: "task" as const,
    targetId: task.id,
    anchor,
    allDay: !task.start_time && anchor === "start",
  };

  return (
    <Popover onClose={onClose} title={`Remind — ${task.title}`}>
      {anchor === "deadline" && (
        <div className="px-1.5 pb-1 text-micro text-muted/80">Before its deadline.</div>
      )}
      <ReminderSelect block target={target} />
    </Popover>
  );
}

function SchedulePicker({
  task,
  onClose,
  mutations,
}: {
  task: Task;
  onClose: () => void;
  mutations: Mutations;
}) {
  const [date, setDate] = useState(task.do_date ?? todayISO());
  const [time, setTime] = useState(task.start_time ? task.start_time.slice(11, 16) : "");

  const apply = () => {
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const [y, mo, d] = date.split("-").map(Number);
      mutations.block(task, new Date(y, mo - 1, d, h, m), undefined, TRIAGE_UNDO);
    } else {
      mutations.planFor(task, date, TRIAGE_UNDO);
    }
    onClose();
  };

  return (
    <Popover onClose={onClose} title={`Schedule — ${task.title}`}>
      <div className="flex items-center gap-2 py-1">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mono border border-line bg-bg px-2 py-1 text-caption outline-none focus:border-accent"
        />
        <input
          type="time"
          value={time}
          step={900}
          onChange={(e) => setTime(e.target.value)}
          className="mono border border-line bg-bg px-2 py-1 text-caption outline-none focus:border-accent"
        />
        <button onClick={apply} className="fast border border-accent bg-accent px-2.5 py-1 text-caption text-on-accent">
          Set
        </button>
      </div>
      <div className="pt-1 text-label text-muted">Leave time empty to plan the day without a block.</div>
    </Popover>
  );
}

function Popover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="rise elev-3 absolute bottom-12 left-2 z-30 w-[330px] rounded-lg border border-line bg-surface p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <div className="truncate pr-2 text-label font-medium text-muted">{title}</div>
        <button onClick={onClose} className="text-label text-muted hover:text-ink">esc</button>
      </div>
      {children}
    </div>
  );
}
