import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { Label, Slot, Task } from "../lib/types";
import { isOverdue, nextWeekISO, todayISO, clockInputValue } from "../lib/dates";
import { undoAutoPatch } from "../lib/grooming";
import { TRASH_LIMIT, TRASH_RETENTION_DAYS, useTrashedTasks, type useTaskMutations } from "../hooks/useTasks";
import TaskComposer, { type TaskComposerHandle } from "./tasks/TaskComposer";
import TaskActionsMenu from "./tasks/TaskActionsMenu";
import { TaskDateMenu, TaskMoveMenu, usePriorityAct, useRenameAct } from "./tasks/TaskMenus";
import { orderBeside, useTaskListKeys } from "./tasks/useTaskListKeys";
import { claimKeys, keyOwner } from "./tasks/keyOwner";
import { restoreFromTrashPatch } from "../lib/types";
import { useVerticalDirectory } from "../hooks/useVertical";
import { useTaskFilter } from "../hooks/useTaskFilter";
import TaskFilter from "./TaskFilter";
import BulkBar from "./BulkBar";
import { useBulkOps } from "../hooks/useBulkOps";
import { queryFacetCount } from "../lib/taskFilter";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useListReorder } from "../hooks/useListReorder";
import { announce } from "../lib/announce";
import { isTypingIn, pressable } from "../lib/a11y";
import { domainById, initiativeById, projectById, taskDomainColor, taskDomainId, taskInitiativeId } from "../lib/vertical";
import ReminderSelect from "./ReminderSelect";
import type { ReminderAnchorKind } from "../../supabase/functions/_shared/reminderRules.ts";
import TaskRow, { type TaskMeta, type TaskRowHandle } from "./TaskRow";
import type { CrownLineData } from "../lib/crownLine";
import WeekPanel, { type WeekDoor } from "./WeekPanel";
import {
  FileOffer,
  HoldOffer,
  HoldsProbe,
  fileCandidates,
  holdCandidates,
  holdable,
  useOfferBudget,
  useStableCandidates,
} from "./nuvo/RailOffers";
import { RAIL_OFFERS_MAX, type RailOfferCandidate } from "../lib/railOffers";
import type { Placement } from "../lib/compose";
import { InboxAddressHint } from "./InboxAddress";
import { skipWhenAsleep } from "./KeepAlive";
import { Button, Dot, Input, IconButton, MenuLabel, Picker, Popover, SectionHeader } from "./kit";
import SlotRunHeader, { slotRunFace } from "./tasks/SlotRunHeader";
import { clockEntries, type ClockEntry } from "../lib/slotRuns";
import { coverage, pruneTo, rangeBetween, selectionClosesOverlay, toggleGroup, toggleId } from "../lib/selection";

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

const NO_SLOTS: readonly Slot[] = [];

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
  slots = NO_SLOTS,
  slotTitle,
  onOpenSlot,
  crownLine,
  onCrownLine,
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
  /** TODAY's slots. With these the rail keeps a slot's tasks together under one
   *  header (and lists an empty slot as held time); without them the clock is
   *  the flat run it always was, so a host that has no slots changes nothing. */
  slots?: readonly Slot[];
  /** Names an untitled slot from what's inside it — lives with the vertical. */
  slotTitle?: (s: Slot, children: Task[]) => string;
  onOpenSlot?: (s: Slot, anchor: DOMRect) => void;
  /** The crown's line (D-207): the Get ready stack's first card, in words —
   *  handed to WeekPanel. `null` says nothing. Memoize it: the rail is memo'd. */
  crownLine?: CrownLineData | null;
  /** Pressing the line opens Get ready (D-207). */
  onCrownLine?: () => void;
}) {
  // The directory, not the whole vertical: the rail labels its rows (project,
  // domain, hue) and offers pickers; it shows no progress. Reading the whole
  // snapshot re-rendered every row on every write anywhere — a block dragged on
  // Thursday redrew the inbox.
  const vertical = useVerticalDirectory();
  const { nav, closeOverlay } = useAppNavigation();

  /** A task's thread back up the vertical: its domain color. */
  const accentOf = (t: Task) => taskDomainColor(vertical, t);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIdsRaw] = useState<Set<string>>(new Set());
  // Holding several rows and having ONE of them open are incompatible: the next
  // act would touch the group while the popover still says "this one". So
  // growing a selection closes the task / slot popover. Modifier-clicks used to
  // leave it up — the row's ⌘/⇧ mousedown `stopPropagation`s, which kept the
  // popover's own click-away from ever hearing the press. Every route in
  // (⌘-click, ⇧-click, ⌘A, x, a slot's ring) goes through here.
  const navRef = useRef(nav);
  navRef.current = nav;
  const setSelectedIds = useCallback(
    (next: Set<string>) => {
      setSelectedIdsRaw(next);
      if (next.size > 0 && selectionClosesOverlay(navRef.current.overlay)) closeOverlay();
    },
    [closeOverlay],
  );
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
  // Every section of the day is a disclosure (the kit's SectionHeader); Done
  // starts shut — it's the quiet tail, a single line until you want it.
  const [todayOpen, setTodayOpen] = useState({ overdue: true, unblocked: true, clock: true, done: false });
  const toggleToday = (key: keyof typeof todayOpen) =>
    setTodayOpen((s) => ({ ...s, [key]: !s[key] }));

  // Dismiss rail micro-overlays when navigation changes (incl. browser back).
  useEffect(() => {
    setContextMenu(null);
    setLabelPickerFor(null);
    setSchedulePickerFor(null);
    setRemindPickerFor(null);
  }, [nav]);

  // The keyboard belongs to the last pane you touched. A press on the calendar
  // (a block, its menu's trigger, empty grid, the toolbar) puts the rail's
  // cursor down — both window listeners hear ⌫ in the capture phase, so a lit
  // rail row and a block's open menu used to be trashed by the same keystroke.
  // The multi-selection stays: it's an explicit pick, and the bulk bar shows it.
  //
  // And the other way: a press in the rail claims the keys back from the grid,
  // which drops its block selection (CalendarPane) — `keyOwner` is the one
  // answer to "whose ⌫ is this".
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && railRef.current?.contains(target)) {
        claimKeys("rail");
        return;
      }
      if (!target?.closest?.("[data-calendar-pane]")) return;
      // Only when there's a cursor to put down: an unconditional set re-rendered
      // the whole rail inside the very pointerdown that may start a drag.
      if (selectedIdRef.current === null) return;
      setKeyCursor(false);
      setSelectedId(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [railRef]);

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

  // The day's clock, with each slot kept whole (lib/slotRuns — the phone draws
  // from the same read, which leaves out a slot with nothing in it — D-188).
  // Filtering narrows the day, and a slot with nothing left that matches must not
  // stand there as if the block were done: it would claim an outcome the filter
  // merely hid (the "never claim a false empty" rule).
  const clock: ClockEntry[] = useMemo(() => {
    const all = clockEntries(todaySections.scheduled, slots, todaySections.done);
    return filtering ? all.filter((e) => e.kind === "task" || e.open.length > 0) : all;
  }, [todaySections.scheduled, todaySections.done, slots, filtering]);

  // List order IS draw order — j / k, ⇧-ranges and ⌘A all walk what's on screen,
  // so a slot's tasks are contiguous (they were sorted by a start time they all
  // share, which scattered them among their neighbours).
  const visible: Task[] = useMemo(
    () =>
      tab === "inbox"
        ? inboxOrdered
        : tab === "trash"
          ? trashed
          : [
              ...todaySections.pinned,
              ...todaySections.unblocked,
              ...clock.flatMap((e) => (e.kind === "slot" ? e.open : [e.task])),
              ...todaySections.done,
            ],
    [tab, inboxOrdered, trashed, todaySections, clock],
  );
  // Only rows that are drawn: a shut section (the Done tail, or any other the
  // hand folded) is in `visible` but not on screen, and an invisible row must
  // never be in a selection or a range.
  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    if (tab !== "today") return hidden;
    const hide = (ts: Task[]) => ts.forEach((t) => hidden.add(t.id));
    if (!todayOpen.overdue) hide(todaySections.pinned);
    if (!todayOpen.unblocked) hide(todaySections.unblocked);
    if (!todayOpen.clock) hide(clock.flatMap((e) => (e.kind === "slot" ? e.open : [e.task])));
    if (!todayOpen.done) hide(todaySections.done);
    return hidden;
  }, [tab, todayOpen, todaySections, clock]);
  const drawn: Task[] = useMemo(
    () => (hiddenIds.size > 0 ? visible.filter((t) => !hiddenIds.has(t.id)) : visible),
    [visible, hiddenIds],
  );
  const drawnIds = useMemo(() => drawn.map((t) => t.id), [drawn]);

  // A selection can only hold rows that still exist and are on screen: complete
  // a selected row, switch to Inbox, collapse Done — the id used to stay, so the
  // bar counted "4 selected" while its acts reached only the two you could see.
  useEffect(() => {
    setSelectedIdsRaw((prev) => pruneTo(prev, drawnIds) as Set<string>);
  }, [drawnIds]);


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

  // The row you're already on — the one whose popover is open, or the one the
  // keyboard has lit. A ⌘-click on a SECOND row means "and this one too", so that
  // row has to be in the selection already; it never was (a plain click only
  // opened its popover), so the first ⌘-click selected one row, drew no bar, and
  // left the first task's popover up over the pick.
  const drawnRowId = openTaskId ?? (keyCursor ? selectedId : null);

  const toggleMultiSelect = (id: string) => {
    const base =
      selectedIds.size === 0 && drawnRowId && drawnRowId !== id && drawnIds.includes(drawnRowId)
        ? new Set([drawnRowId])
        : selectedIds;
    setSelectedIds(toggleId(base, id));
    setSelectedId(id);
    setAnchorId(id);
    setKeyCursor(false);
  };

  // Shift-click: select every row between the anchor and this one, inclusive —
  // over the rows that are DRAWN, so a range never sweeps through a collapsed
  // Done tail or the inside of a slot you can't see.
  const selectRangeTo = (id: string) => {
    const anchor = anchorId ?? drawnRowId;
    const range = rangeBetween(drawnIds, anchor, id);
    if (!range) return;
    setSelectedIds(range);
    setSelectedId(id);
    setKeyCursor(false);
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

  // Empty paper lets go of the selection — the way out that needs no key (Esc is
  // the keyboard's). A listener rather than an onClick on the list: the paper is
  // not a control, and anything that IS one (a row, a slot's header, a button)
  // keeps its own meaning.
  const hasSelection = selectedIds.size > 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !hasSelection) return;
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-task-drag],[data-slot-run],button,a,input,textarea")) return;
      setSelectedIdsRaw(new Set());
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [hasSelection]);
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
  // `coalesceKey` makes one drop of several rows ONE toast and one ⌘Z.
  const dropActs: Record<string, { label: (t: Task) => string; run: (t: Task, coalesceKey?: string) => void }> = {
    inbox: {
      label: (t) => `↩ Back to ${homeOf(t)}`,
      run: (t, coalesceKey) =>
        mutations.backToInbox(t, {
          undo: "toast",
          label: `${t.title} — ${homeOf(t)}`,
          coalesceKey,
        }),
    },
    today: {
      label: () => "→ Onto today",
      run: (t, coalesceKey) =>
        mutations.planFor(t, todayISO(now), {
          undo: "toast",
          label: `${t.title} — today`,
          coalesceKey,
        }),
    },
  };

  // What a drag onto a tab carries: the whole multi-selection when the row you
  // picked up is part of it, else that row. Captured when the drag STARTS — the
  // drop used to act on the one row under the pointer, so three selected rows
  // dragged to Inbox moved one and left two behind. (The calendar's drop has
  // captured the group at drag start all along; this is the same rule.)
  const tabDragGroupRef = useRef<string[] | null>(null);
  const groupFor = (id: string) =>
    selectedIds.size > 1 && selectedIds.has(id)
      ? visible.filter((t) => selectedIds.has(t.id)).map((t) => t.id)
      : null;
  const groupLabel = (key: string, ids: string[]) => {
    const rows = ids.map((x) => byId.get(x)).filter((t): t is Task => Boolean(t));
    if (key === "today") return `→ Onto today · ${rows.length} tasks`;
    const homes = new Set(rows.map(homeOf));
    return homes.size === 1
      ? `↩ Back to ${[...homes][0]} · ${rows.length} tasks`
      : `↩ ${rows.length} tasks back to Inbox and their projects`;
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
      const act = dropActs[key];
      if (!act) return;
      const ids = tabDragGroupRef.current ?? [id];
      tabDragGroupRef.current = null;
      const rows = ids.map((x) => byId.get(x)).filter((t): t is Task => Boolean(t));
      // Mutation layer owns the toast + Undo (D-063a destination label above);
      // a group shares one coalesce key, so it's one toast and one ⌘Z.
      const coalesceKey = rows.length > 1 ? `rail-tab-drop:${Date.now()}` : undefined;
      rows.forEach((t) => act.run(t, coalesceKey));
    },
    zoneLabel: (key, id) => {
      const group = tabDragGroupRef.current;
      if (group && group.length > 1) return groupLabel(key, group);
      return dropActs[key]?.label(byId.get(id) ?? ({} as Task)) ?? "";
    },
    onPointerDown: () => {
      preDragSelection.current = selectedIdRef.current;
    },
    onDragStart: (id) => {
      tabDragGroupRef.current = groupFor(id);
    },
    onDragEnd: () => {
      tabDragGroupRef.current = null;
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
  const railKeysOn =
    hotkeysEnabled && !rowMenu && !editingId && !contextMenu && !labelPickerFor && !schedulePickerFor && !remindPickerFor;
  useTaskListKeys({
    // …and only while the rail is the pane last pressed in (keyOwner): with a
    // block selected on the grid, j / ⌫ / e belong to the block.
    enabled: () => railKeysOn && keyOwner() === "rail",
    // Only rows that are drawn: j past the last one should reach the capture
    // box, not walk into a collapsed "done" tail.
    rows: drawn,
    cursor: {
      // Keys act on a row you can SEE. A click selects without drawing the
      // cursor (the lift means "its popover is open"), and that invisible
      // selection used to stay armed: click a row, close its popover, click the
      // calendar, press ⌫ — and the rail trashed the row nobody was looking at,
      // then lit its neighbour for the next ⌫. An unlit click is only where j / k
      // start from.
      cursorId: keyCursor ? selectedId : null,
      homeId: keyCursor ? null : selectedId,
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
      // `.` — the row's right-click menu, beside the row.
      menu: (t) => {
        const r = rowRect(t.id);
        setContextMenu({ task: t, x: r.left + 24, y: r.bottom });
      },
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
            if (selectedIds.size === 0 && !(keyCursor && selectedId) && filtering) {
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

  // The add box is a place, not a row act — `a` / `c` reach it from the grid too.
  // While a block holds the keys the list above stands down entirely, which
  // took the box's own letters with it. Bubble phase: the grid's capture-phase
  // keys have had their turn (it binds neither letter).
  const railKeysOnRef = useRef(railKeysOn);
  railKeysOnRef.current = railKeysOn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyOwner() !== "grid" || !railKeysOnRef.current) return;
      if (e.defaultPrevented || isTypingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "a" && e.key !== "A" && e.key !== "c") return;
      if (document.querySelector("[data-nested-surface]")) return;
      e.preventDefault();
      captureRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Nuvo's offers at rest (D-205, docs/rail-modes.md §3) ─────────────────
  // One chip per row, written as the destination, three at most across the
  // whole rail — the crown's open rows first, then the face showing (Today's
  // holds, earliest first; the Inbox's filings, top first). The budget is
  // decided once (lib/railOffers `budgetOffers`); past it, nothing. The rail is
  // only mounted at rest — Plan and Repair replace it — so it never offers
  // while a mode owns it.
  const [pathCands, setPathCands] = useState<RailOfferCandidate[]>([]);
  const [holds, setHolds] = useState<Map<string, Placement>>(() => new Map());
  const today0 = todayISO(now);
  const holdPool = useMemo(
    () => (tab === "today" ? holdable(todaySections.unblocked, today0) : []),
    [tab, todaySections.unblocked, today0],
  );
  const offerCands = useStableCandidates([
    ...pathCands,
    ...(tab === "today" ? holdCandidates(holds).filter((c) => holdPool.some((t) => t.id === c.rowId)) : []),
    ...(tab === "inbox" ? fileCandidates(inboxOrdered) : []),
  ]);
  const offers = useOfferBudget(offerCands, RAIL_OFFERS_MAX);
  const homeOfProject = (id: string) => {
    const p = projectById(vertical, id);
    return p ? { initiativeId: p.initiativeId, domainId: p.domainId } : null;
  };
  const offerFor = (t: Task) => {
    const o = offers.get(t.id);
    if (!o) return undefined;
    if (o.kind === "hold") {
      const p = holds.get(t.id);
      return p ? <HoldOffer task={t} placement={p} mutations={mutations} /> : undefined;
    }
    if (o.kind === "file") return <FileOffer task={t} mutations={mutations} homeOfProject={homeOfProject} />;
    return undefined;
  };

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
    // The Today face already names the day; a row still says its clock.
    dayShown: tab === "today",
    draggable: true,
    dragging: draggingId === t.id,
    dragGroup: selectedIds.has(t.id) ? dragGroupStr : undefined,
    accent: accentOf(t),
    meta: metaOf(t),
    offer: offerFor(t),
    onSelect: () => plainSelect(t.id),
    onOpen: (anchor: DOMRect) => {
      setSelectedIds(new Set());
      onOpenTask(t, anchor);
    },
    onToggleDone: () => (t.status === "done" ? mutations.uncomplete(t) : mutations.complete(t)),
    onMultiToggle: () => toggleMultiSelect(t.id),
    onRangeSelect: () => selectRangeTo(t.id),
    onContextMenu: (e: React.MouseEvent) => openContextMenu(t, e),
    // The router's guess is no longer an Accept / ✕ pair on every inbox row: it
    // is "File in <place>", one of the rail's offers, inside the budget (D-205).
    onUndoAutoFile: () => mutations.patchTask(t.id, undoAutoPatch(t)),
  });

  // A slot as the head of its tasks (D-178). The header opens the slot; its ring
  // picks everything inside for the bulk bar. A hairline in the slot's hue runs
  // down the gutter beside its tasks, so they read as inside it without a frame.
  const renderSlotRun = (run: Extract<ClockEntry, { kind: "slot" }>) => {
    const face = slotRunFace(run, slotTitle ? slotTitle(run.slot, run.open) : run.slot.title);
    const ids = run.open.map((t) => t.id);
    return (
      <div key={`slot:${run.slot.id}`} style={{ ["--slot-h" as string]: face.color }}>
        <SlotRunHeader
          slotId={run.slot.id}
          {...face}
          coverage={coverage(selectedIds, ids)}
          selectable={ids.length > 0}
          onOpen={(anchor) => onOpenSlot?.(run.slot, anchor)}
          onToggleSelect={() => {
            setSelectedIds(toggleGroup(selectedIds, ids));
            setAnchorId(ids[0] ?? null);
            setKeyCursor(false);
          }}
        />
        {ids.length > 0 && (
          <div className="slot-run-tasks">
            {run.open.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
          </div>
        )}
      </div>
    );
  };

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

  // The keyed pickers (# · r · b) open beside the row they act on. Measured
  // once per open, not per render — the rail re-renders on the clock.
  const pickerFor = labelPickerFor ?? schedulePickerFor ?? remindPickerFor;
  const pickerAnchor = useMemo(
    () => (pickerFor ? rowRect(pickerFor.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickerFor?.id],
  );

  // A section of the day: the kit's SectionHeader (name · count · disclosure)
  // over its rows. Shut, its rows leave `drawn` too (see `hiddenIds`).
  const section = (
    key: keyof typeof todayOpen,
    title: string,
    count: number,
    body: React.ReactNode,
  ) => (
    <section key={key} className="rail-section">
      <SectionHeader title={title} count={count} collapsed={!todayOpen[key]} onToggle={() => toggleToday(key)} />
      {todayOpen[key] && body}
    </section>
  );
  const nothingToday = todaySections.pinned.length + todaySections.unblocked.length + clock.length === 0;

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
        className="rail-inner relative flex h-full flex-col"
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
        className={`rail-resize ${collapsed || squeezed ? "hidden" : ""}`}
      />
      {/* Clears macOS traffic lights — explicit drag target, not inherited from deep. */}
      <div data-tauri-drag-region className="rail-titlebar-drag w-full shrink-0" aria-hidden />
      <div data-tauri-drag-region="deep" className="shrink-0">
        {/* The crown — the planner's one hero (the week's span), its fact, and
            the week's projects. Its door is "Plan the week". */}
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
          // what you opened to get here.
          renderTask={(t, { action, draggable, dragData, whenShown }) => (
            <TaskRow
              key={t.id}
              {...rowProps(t)}
              ref={undefined}
              meta={undefined}
              offer={undefined}
              dayShown={false}
              draggable={draggable ?? false}
              action={action}
              whenShown={whenShown}
              dragData={dragData}
            />
          )}
          // The crown's line (D-207): the door to Get ready, said as a fact.
          line={crownLine}
          onLine={onCrownLine}
          offers={offers}
          onPathCandidates={setPathCands}
        />
        {/* The faces — Today and Inbox, the day's two; Trash is recovery, so it
            sits as an icon at the strip's end, only while it holds something
            (D-136). Mid-drag the two faces become the two acts you can perform
            on the row in hand. */}
        <div className="rail-tabs">
          {(["today", "inbox"] as const).map((t) => {
            // Three states, because "you could drop here" and "you are about to"
            // are different promises: resting · armed (a compatible row is in
            // hand) · ready (the pointer is on it, release commits). Trash is a
            // face, not a destination (D-104), so it never arms.
            const armed = Boolean(draggingId) && t !== tab;
            const ready = zone === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => {
                  if (suppressTabClickRef.current) return;
                  setTab(t);
                }}
                {...(t === "inbox"
                  ? { "data-inbox-tab": "", "data-teach": "inbox-tab" }
                  : { "data-today-tab": "" })}
                className={`rail-tab ${ready ? "rail-tab-ready" : armed ? "rail-tab-armed" : ""}`}
              >
                {t === "inbox" ? "Inbox" : "Today"}
                <span className="rail-tab-count">{tabCount(t)}</span>
              </button>
            );
          })}
          <div className="rail-tabs-end">
            {trashed.length > 0 && (
              <IconButton
                size="xs"
                data-trash-tab=""
                label={`Trash · ${trashed.length >= TRASH_LIMIT ? `${TRASH_LIMIT}+` : trashed.length}`}
                aria-pressed={tab === "trash"}
                icon={<Icon name="trash" size={14} />}
                onClick={() => {
                  if (suppressTabClickRef.current) return;
                  setTab("trash");
                }}
              />
            )}
            {/* The filter modifies the face you're looking at, so it rides the
                strip. Inert on Trash — a filtered trash could hide the row you
                came back for without saying so. */}
            {tab !== "trash" && (
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
                // Its trigger sits in the strip as the kit's 24px icon button.
                className="rail-filter"
              />
            )}
          </div>
        </div>
      </div>

      {/* List — opt out of the titlebar drag region so row drags aren't window drags */}
      <div
        ref={listRef}
        className="rail-list relative min-h-0 flex-1 overflow-y-auto"
        data-tauri-drag-region="false"
        data-teach="day-list"
      >
        {/* Where a released row will land is drawn by useListReorder (the line
            and the "you're about to…" chip are plain DOM it repaints per frame)
            — the list never reflows to show it. */}

        {holdPool.length > 0 && <HoldsProbe tasks={holdPool} now={now} onHolds={setHolds} />}
        {tab === "inbox" && (
          <>
            {inboxOrdered.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
            {inboxOrdered.length === 0 &&
              // Never claim inbox zero over a filter: a short list reads as
              // "you're on top of it", the one lie a planner must not tell.
              (filtering ? (
                <EmptyState text="Nothing matches the filter" />
              ) : (
                <>
                  <EmptyState text="Inbox zero" />
                  <InboxAddressHint />
                </>
              ))}
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
            {/* Overdue — the group whose members need a *decision* while
                everything below needs execution. The glossary's own term,
                stated as a fact, so the word comes off every row. */}
            {todaySections.pinned.length > 0 &&
              section(
                "overdue",
                "Overdue",
                todaySections.pinned.length,
                todaySections.pinned.map((t) => <TaskRow key={t.id} {...rowProps(t)} />),
              )}
            {/* The day's work, split by the one fact that says whether it will
                happen: does it have a time? The work with no time comes first —
                it's the part of today that's still a wish (D-148). Same two
                names as the phone's `MobileTaskList`. */}
            {todaySections.unblocked.length > 0 &&
              section(
                "unblocked",
                "No time yet",
                todaySections.unblocked.length,
                todaySections.unblocked.map((t) => <TaskRow key={t.id} {...rowProps(t)} />),
              )}
            {clock.length > 0 &&
              section(
                "clock",
                "On the clock",
                todaySections.scheduled.length,
                clock.map((entry) =>
                  entry.kind === "task" ? <TaskRow key={entry.task.id} {...rowProps(entry.task)} /> : renderSlotRun(entry),
                ),
              )}
            {nothingToday && <EmptyState text={filtering ? "Nothing matches the filter" : "Nothing today"} />}
            {/* Done — the quiet tail, shut until you want it. */}
            {todaySections.done.length > 0 &&
              section(
                "done",
                "Done",
                todaySections.done.length,
                todaySections.done.map((t) => <TaskRow key={t.id} {...rowProps(t)} />),
              )}
          </>
        )}
      </div>

      {/* Capture — the kit's field at the foot of the pool, out of the
          hierarchy: it interrupts every mode, so it isn't a titled section.
          Stays a real <input> so iOS dictation works (low-data-entry).
          A (or C) focuses it — the keycap says so. */}
      <div className="rail-foot shrink-0" data-tauri-drag-region="false" data-teach="capture">
        <TaskComposer
          ref={captureRef}
          variant="pill"
          placeholder="Capture"
          shortcut="A"
          context={tab === "today" ? { doDate: todayISO(now) } : undefined}
          contextLabel={tab === "today" ? { name: "Today" } : { name: "Inbox" }}
          onCreated={({ action }) => {
            setCaptureError(null);
            if (action.kind === "series" || action.input.do_date) setTab("today");
          }}
          onError={setCaptureError}
          onArrowUp={() => {
            // The last row that's actually drawn — a shut section's aren't.
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
          <div className="rail-foot-error" role="alert">
            {captureError}
          </div>
        )}
      </div>

      {/* Bulk actions — one bar, shared with the phone (BulkBar.tsx). */}
      {selectedIds.size > 0 && (
        <BulkBar
          count={selectedIds.size}
          ops={bulkOps}
          labels={labels}
          vertical={vertical}
          total={drawnIds.length}
          onSelectAll={() => setSelectedIds(new Set(drawnIds))}
        />
      )}

      {labelPickerFor && (
        <LabelPicker
          task={labelPickerFor}
          anchor={pickerAnchor}
          labels={labels}
          onClose={() => setLabelPickerFor(null)}
          onSet={(ids) => mutations.setLabels(labelPickerFor.id, ids)}
        />
      )}
      {schedulePickerFor && (
        <SchedulePicker
          task={schedulePickerFor}
          anchor={pickerAnchor}
          onClose={() => setSchedulePickerFor(null)}
          mutations={mutations}
        />
      )}
      {remindPickerFor && (
        <RemindPicker task={remindPickerFor} anchor={pickerAnchor} onClose={() => setRemindPickerFor(null)} />
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

/** Two or three words, centred in the pool. */
function EmptyState({ text }: { text: string }) {
  return <div className="rail-empty">{text}</div>;
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
  anchor,
  labels,
  onClose,
  onSet,
}: {
  task: Task;
  anchor: DOMRect | null;
  labels: Label[];
  onClose: () => void;
  onSet: (ids: string[]) => void;
}) {
  // The picker holds its own set: the row's `task` is the snapshot it opened
  // on, so two ticks in a row must build on each other, not on that snapshot.
  const [current, setCurrent] = useState<string[]>(() => (task.task_labels ?? []).map((tl) => tl.label_id));
  if (labels.length === 0) {
    return (
      <Popover anchor={anchor} open onClose={onClose} label="Labels" className="rail-pick">
        <MenuLabel>No labels</MenuLabel>
      </Popover>
    );
  }
  return (
    <Picker
      anchor={anchor}
      open
      onClose={onClose}
      label="Labels"
      multiple
      value={current}
      options={labels.map((l) => ({ value: l.id, label: l.name, icon: <Dot color={l.color ?? "var(--faint)"} shape="round" /> }))}
      onChange={(id) => {
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        setCurrent(next);
        onSet(next);
      }}
    />
  );
}

/**
 * The trash.
 *
 * Rows on the pool, not cards — nothing here floats. Two acts per row, and the
 * destructive one asks: **Delete forever** is the only act in the app with no
 * undo, so it turns solid danger only once it is confirming.
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
    return <EmptyState text="Trash is empty" />;
  }

  return (
    <section className="rail-section">
      <SectionHeader
        title={<span title={`Deleted tasks are kept ${TRASH_RETENTION_DAYS} days`}>Trash</span>}
        count={tasks.length}
        actions={
          <Button
            size="xs"
            kind={emptyConfirm ? "danger-solid" : "ghost"}
            onClick={() => {
              if (emptyConfirm) {
                onPurgeAll();
                setEmptyConfirm(false);
              } else {
                setEmptyConfirm(true);
              }
            }}
            onBlur={() => setEmptyConfirm(false)}
          >
            {emptyConfirm ? "Delete all?" : "Empty trash"}
          </Button>
        }
      />
      {tasks.map((t) => {
        const isConfirming = confirming === t.id;
        return (
          <div
            key={t.id}
            data-task-id={t.id}
            onClick={() => onSelect(t.id)}
            {...pressable(() => onSelect(t.id), { role: "option", label: t.title || "Untitled" })}
            aria-selected={selectedId === t.id}
            className="trash-row"
          >
            <span className="trash-title">{t.title || "Untitled"}</span>
            {t.trashed_at && <span className="trash-when">{deletedWhen(t.trashed_at)}</span>}
            <span className="trash-acts">
              <Button
                size="xs"
                kind="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore(t);
                }}
              >
                Restore
              </Button>
              <Button
                size="xs"
                kind={isConfirming ? "danger-solid" : "ghost"}
                title="Can't be undone"
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
              >
                {isConfirming ? "Sure?" : "Delete forever"}
              </Button>
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** "2h ago" — the one fact a trash row owes you beyond its name (the face
 *  already says they were deleted). */
function deletedWhen(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * Remind, from the keyboard (`b` on the focused row) — the shared reminder
 * select in the kit's popover, beside the row it acts on.
 */
function RemindPicker({ task, anchor, onClose }: { task: Task; anchor: DOMRect | null; onClose: () => void }) {
  const kind: ReminderAnchorKind = task.start_time || !task.deadline ? "start" : "deadline";
  const target = {
    targetKind: "task" as const,
    targetId: task.id,
    anchor: kind,
    allDay: !task.start_time && kind === "start",
  };

  return (
    <Popover anchor={anchor} open onClose={onClose} label={`Remind — ${task.title}`} className="rail-pick">
      <MenuLabel>{kind === "deadline" ? "Remind before its deadline" : "Remind"}</MenuLabel>
      <div className="rail-pick-body">
        <ReminderSelect block target={target} />
      </div>
    </Popover>
  );
}

/** Schedule, from the keyboard (`r`): a day, and a time if it has one. An
 *  empty time plans the day without a block. */
function SchedulePicker({
  task,
  anchor,
  onClose,
  mutations,
}: {
  task: Task;
  anchor: DOMRect | null;
  onClose: () => void;
  mutations: Mutations;
}) {
  const [date, setDate] = useState(task.do_date ?? todayISO());
  const [time, setTime] = useState(clockInputValue(task.start_time));

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
    <Popover anchor={anchor} open onClose={onClose} label={`Schedule — ${task.title}`} className="rail-pick">
      <MenuLabel>Schedule</MenuLabel>
      <form
        className="rail-pick-body"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="rail-pick-fields">
          <Input size="sm" type="date" aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input
            size="sm"
            type="time"
            aria-label="Time — leave empty to plan the day without a block"
            title="Leave empty to plan the day without a block"
            step={900}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <Button type="submit" kind="primary" full shortcut="↵">
          Set
        </Button>
      </form>
    </Popover>
  );
}
