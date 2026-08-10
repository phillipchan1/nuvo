import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { createPortal } from "react-dom";
import type { Label, Task } from "../lib/types";
import { isOverdue, nextWeekISO, todayISO, tomorrowISO } from "../lib/dates";
import { captureTitle, parseCapture } from "../lib/nlp";
import { acceptPatch, dismissPatch } from "../lib/grooming";
import type { NewTaskInput, useTaskMutations } from "../hooks/useTasks";
import { useRecurrenceMutations, useRecurrences } from "../hooks/useRecurrence";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useListReorder } from "../hooks/useListReorder";
import { domainById, initiativeById, projectById, taskDomainColor, taskDomainId, taskInitiativeId } from "../lib/vertical";
import { useOptionalUndoStack } from "../hooks/useUndoStack";
import TaskRow, { type TaskMeta } from "./TaskRow";
import WeekPanel, { type WeekDoor } from "./WeekPanel";
import { SectionLabel } from "./ui";

export type RailTab = "inbox" | "today";
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

export default function LeftRail({
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
  now: Date;
  railRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Focus mode: slide the rail closed so the calendar takes the whole width. */
  collapsed?: boolean;
  /** The week door's lifecycle, worn by the WeekPanel header that crowns us. */
  weekDoor?: WeekDoor;
}) {
  const { data: vertical, toggleTaskSprint } = useVertical();
  const { recordUndo } = useOptionalUndoStack();
  const recurrenceMutations = useRecurrenceMutations();
  const { nav } = useAppNavigation();

  /** A task's thread back up the vertical: its domain color. */
  const accentOf = (t: Task) => taskDomainColor(vertical, t);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The pivot for shift-click range selection — the last row touched plainly
  // or cmd-toggled. Range runs from here to the shift-clicked row.
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ task: Task; x: number; y: number } | null>(null);
  const [labelPickerFor, setLabelPickerFor] = useState<Task | null>(null);
  const [schedulePickerFor, setSchedulePickerFor] = useState<Task | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [railWidth, setRailWidth] = useState(readRailWidth);
  const [capture, setCapture] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
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
  }, [nav]);

  const todaySections = useMemo(() => buildTodaySections(today, now), [today, now]);
  // The inbox is a hand-ordered queue, so it renders by sort_order rather than
  // by whatever the cache happens to hold — an optimistic reorder patches rows
  // in place without re-sorting them, so without this the drop wouldn't show
  // until the refetch landed.
  const inboxOrdered = useMemo(
    () => [...inbox].sort((a, b) => a.sort_order - b.sort_order),
    [inbox],
  );

  const visible: Task[] =
    tab === "inbox"
      ? inboxOrdered
      : [...todaySections.pinned, ...todaySections.unblocked, ...todaySections.scheduled, ...todaySections.done];

  const selected = visible.find((t) => t.id === selectedId) ?? null;

  // Keyboard-first quick actions
  useEffect(() => {
    if (!hotkeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Targets: multi-select if active, else the keyboard cursor
      const targets = selectedIds.size > 1
        ? visible.filter((t) => selectedIds.has(t.id))
        : selected ? [selected] : [];

      const idx = selected ? visible.findIndex((t) => t.id === selected.id) : -1;
      const move = (delta: number) => {
        const next = visible[Math.min(visible.length - 1, Math.max(0, idx + delta))];
        if (next) { setSelectedId(next.id); setSelectedIds(new Set()); }
      };

      switch (e.key) {
        case "Escape":
          setSelectedIds(new Set());
          setContextMenu(null);
          break;
        case "ArrowDown":
        case "j":
          e.preventDefault();
          idx === -1 ? visible[0] && setSelectedId(visible[0].id) : move(1);
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          idx === -1 ? visible[0] && setSelectedId(visible[0].id) : move(-1);
          break;
        case "Enter":
          if (targets.length === 1) {
            const el = document.querySelector<HTMLElement>(`[data-task-drag="${targets[0].id}"]`);
            const anchor = el?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40);
            onOpenTask(targets[0], anchor);
          }
          break;
        case "e":
          targets.forEach((t) => mutations.planFor(t, todayISO(), TRIAGE_UNDO));
          break;
        case "t":
          targets.forEach((t) => mutations.planFor(t, tomorrowISO(), TRIAGE_UNDO));
          break;
        // Bare s / w / d / m belong to the Schedule (view switching), so the
        // rail's three colliding triage actions live on n / f / r instead.
        case "n":
          targets.forEach((t) => mutations.planFor(t, nextWeekISO(), TRIAGE_UNDO));
          break;
        case "f":
          targets.forEach((t) =>
            t.status === "done" ? mutations.uncomplete(t) : mutations.complete(t),
          );
          break;
        case "x":
          targets.forEach((t) => mutations.trash(t));
          setSelectedId(null);
          setSelectedIds(new Set());
          break;
        case "i":
          targets.filter((t) => t.status !== "inbox").forEach((t) => mutations.backToInbox(t, TRIAGE_UNDO));
          break;
        case "r":
          if (targets.length === 1) setSchedulePickerFor(targets[0]);
          break;
        case "#":
          if (targets.length === 1) {
            e.preventDefault();
            setLabelPickerFor(targets[0]);
          }
          break;
        case "1":
          setTab("inbox");
          break;
        case "2":
          setTab("today");
          break;
        case "c":
          e.preventDefault();
          captureRef.current?.focus();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeysEnabled, selected, selectedIds, visible, mutations, onOpenTask, setTab]);

  const submitCapture = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = capture.trim();
    if (!text || capturing) return;
    setCaptureError(null);
    setCapturing(true);
    try {
      const p = parseCapture(text);
      if (p.recurrence) {
        const anchor = p.recurrenceAnchor ?? p.doDate ?? todayISO(now);
        const startMins = p.startTime
          ? p.startTime.getHours() * 60 + p.startTime.getMinutes()
          : null;
        await recurrenceMutations.createSeries({
          kind: "task",
          rule: p.recurrence,
          anchorISO: anchor,
          template: {
            title: captureTitle(p, text),
            duration_minutes: p.durationMinutes ?? 30,
            time_of_day_minutes: startMins,
            priority: p.priority,
          },
        });
        setCapture("");
        setTab("today");
        return;
      }
      const labelIds = p.labels
        .map((name) => labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id));
      const input: NewTaskInput = {
        title: captureTitle(p, text),
        notes: p.notes ?? undefined,
        do_date: p.doDate ?? (tab === "today" ? todayISO(now) : null),
        start_time: p.startTime?.toISOString() ?? null,
        duration_minutes: p.durationMinutes,
        priority: p.priority,
        labelIds,
      };
      const task = await mutations.create(input);
      setCapture("");
      if (task.status !== "inbox") setTab("today");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save task";
      setCaptureError(msg);
      console.error("[nuvo] capture failed:", err);
    } finally {
      setCapturing(false);
    }
  };

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
  };

  const openContextMenu = (t: Task, e: React.MouseEvent) => {
    // cmd/ctrl-click is multi-select, not a context-menu request (on macOS a
    // ctrl-click also fires contextmenu — don't let it hijack the toggle).
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
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

  const { draggingId, lineTop, zone } = useListReorder({
    containerRef: listRef,
    itemSelector: "[data-task-drag]",
    idAttr: "data-task-drag",
    bandOf: (id) => bands.of.get(id) ?? null,
    bandIds: (band) => bands.ids.get(band) ?? [],
    // A tab only offers itself when the act would change something: you can't
    // take an inbox row off the day, and a row already on the day is already there.
    externalDropAt: (x, y) => {
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!hit) return null;
      if (tab === "today" && hit.closest("[data-inbox-tab]")) return "inbox";
      if (tab === "inbox" && hit.closest("[data-today-tab]")) return "today";
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
      setSelectedId(preDragSelection.current);
      setSelectedIds(new Set());
    },
    onCommit: (_band, ids) => {
      // Re-deal the band's OWN sort_order values instead of renumbering 0..n.
      // sort_order is a global column — a project's steps and a slot's children
      // read it too — so a reorder here must not renumber rows it can't see.
      const pool = ids.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t));
      if (pool.length < 2) return;
      let vals = pool.map((t) => t.sort_order).sort((a, b) => a - b);
      // Ties (every fresh capture lands on the same default) can't express an
      // order — spread them densely from the band's own floor.
      if (new Set(vals).size !== vals.length) vals = vals.map((_, i) => vals[0] + i);
      const befores = pool.map((t) => ({ id: t.id, sort_order: t.sort_order }));
      const changed = pool.filter((t, i) => t.sort_order !== vals[i]);
      if (!changed.length) return;
      pool.forEach((t, i) => {
        if (t.sort_order !== vals[i]) mutations.patchTask(t.id, { sort_order: vals[i] }, { undo: false });
      });
      recordUndo({
        label: "Reordered",
        shortLabel: "Reordered",
        tier: "silent",
        coalesceKey: "reorder",
        undo: () => {
          befores.forEach(({ id, sort_order }) =>
            mutations.patchTask(id, { sort_order }, { undo: false }),
          );
        },
      });
    },
  });

  const rowProps = (t: Task) => ({
    task: t,
    labels,
    // One clock for the row and the group that sorted it — see TaskRow's `now`.
    now,
    selected: t.id === selectedId,
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

  const tabCount = (t: RailTab) =>
    t === "inbox" ? inbox.length : today.filter((x) => x.status !== "done").length;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = railWidth;
    let latest = startW;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      latest = Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, startW + ev.clientX - startX));
      setRailWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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
        className={`absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize touch-none hover:bg-accent/20 active:bg-accent/35 ${collapsed ? "hidden" : ""}`}
      />
      {/* Clears macOS traffic lights — explicit drag target, not inherited from deep. */}
      <div data-tauri-drag-region className="rail-titlebar-drag w-full shrink-0" aria-hidden />
      <div data-tauri-drag-region="deep" className="shrink-0">
        {/* The week's plan — priorities held in view all week, crowning the rail.
            Its header is the week door ("Plan the week"). */}
        <WeekPanel door={weekDoor} />
        {/* Tabs — Today first (the day is where the rail's lower zone lives);
            Inbox second. This zone is "work the day," under the week crown. */}
        {/* The strip carries one continuous baseline so the active underline sits ON
            a line instead of floating between the crown's divider and nothing. */}
        <div className="flex border-b border-line">
          {(["today", "inbox"] as const).map((t) => {
            // Three states, because "you could drop here" and "you are about to"
            // are different promises: resting · armed (a compatible row is in
            // hand) · ready (the pointer is on it, release commits).
            const armed = Boolean(draggingId) && t !== tab;
            const ready = zone === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
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
        </div>
      </div>

      {/* List — opt out of the titlebar drag region so row drags aren't window drags */}
      <div ref={listRef} className="rail-list relative min-h-0 flex-1 overflow-y-auto" data-tauri-drag-region="false" data-teach="day-list">
        {/* Where a released row will land. The list never reflows to show it —
            rows shifting under the cursor is what made the old drop chrome read
            as the list jumping away from you. */}
        {lineTop != null && (
          <div className="reorder-insert-line" style={{ top: lineTop }} aria-hidden />
        )}
        {/* The "you're about to..." label itself is plain DOM, owned by
            useListReorder (`zoneLabel` above) — same idiom as the calendar's
            slot chip, and for the same reason: it repaints every pointermove,
            and routing that through React state re-rendered the whole rail. */}

        {tab === "inbox" && (
          <>
            {inboxOrdered.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
            {inboxOrdered.length === 0 && <EmptyState text="Inbox zero. Capture with C or ⌘K." />}
          </>
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
            {/* The day's work — planned + calendar-blocked as one flat list. The
                old split into three titled, counted sections was three headers
                doing one job, and the calendar sits right beside the rail
                rendering the blocks in their real positions.
                ⚠️ This comment used to also claim "a blocked task already shows
                its time." It does not: `TaskRow` deliberately renders no clock
                (see its note above `durText`), and in fact SUPPRESSES the date
                label once `start_time` is set — a scheduled row shows strictly
                less than an unscheduled one. So the flat list rests on the
                adjacent calendar alone, which is a real argument; it just isn't
                the one that was written down. Whether the split should come back
                is a live product question, deliberately left open (D-084) rather
                than settled by a comment that wasn't true. Mobile still keeps an
                "On the clock" header (`MobileTaskList`), where no grid is beside
                the list to carry it. */}
            {[...todaySections.unblocked, ...todaySections.scheduled].map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} />
            ))}
            {todaySections.pinned.length +
              todaySections.unblocked.length +
              todaySections.scheduled.length ===
              0 && (
              <div className="px-3 py-6 text-center text-caption text-muted">
                Nothing for today yet — capture below, or drag from the calendar.
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
          (low-data-entry). Press C to focus. */}
      <form onSubmit={(e) => void submitCapture(e)} className="shrink-0 border-t border-line p-2.5" data-tauri-drag-region="false" data-teach="capture">
        <div className="relative">
          {/* A quill — capture is organic free text, the front door, not a form. */}
          <Icon name="pen" size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-accent" />
          <input
            ref={captureRef}
            value={capture}
            disabled={capturing}
            onChange={(e) => {
              setCapture(e.target.value);
              if (captureError) setCaptureError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitCapture();
              }
            }}
            placeholder="Capture anything…"
            className="w-full rounded-full border border-line-strong bg-surface py-2 pl-10 pr-9 text-body outline-none placeholder:text-muted/70 focus:border-accent disabled:opacity-60"
          />
          {!capture && (
            <kbd className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line px-1 text-micro text-muted">
              C
            </kbd>
          )}
        </div>
        {captureError && (
          <div className="mt-1 px-1 text-label text-signal">{captureError}</div>
        )}
      </form>

      {/* Bulk action bar — slides up when ≥2 tasks are multi-selected */}
      {selectedIds.size > 1 && (
        <div className="rise flex shrink-0 items-center gap-2 border-t border-accent/30 bg-accent-soft px-3 py-2">
          <span className="mono text-label font-semibold text-accent">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <button
            onClick={() => {
              visible.filter((t) => selectedIds.has(t.id)).forEach((t) => mutations.planFor(t, todayISO(now), TRIAGE_UNDO));
              setSelectedIds(new Set());
            }}
            className="fast rounded border border-line px-2 py-0.5 text-label text-muted hover:border-accent hover:text-accent"
          >
            → Today
          </button>
          <button
            onClick={() => {
              visible.filter((t) => selectedIds.has(t.id)).forEach((t) => mutations.backToInbox(t, TRIAGE_UNDO));
              setSelectedIds(new Set());
            }}
            className="fast rounded border border-line px-2 py-0.5 text-label text-muted hover:border-accent hover:text-accent"
          >
            → Inbox
          </button>
          <button
            onClick={() => {
              visible.filter((t) => selectedIds.has(t.id)).forEach((t) => mutations.complete(t));
              setSelectedIds(new Set());
            }}
            className="fast rounded border border-line px-2 py-0.5 text-label text-muted hover:border-accent hover:text-accent"
          >
            ✓ Done
          </button>
          <button
            onClick={() => {
              visible.filter((t) => selectedIds.has(t.id)).forEach((t) => mutations.trash(t));
              setSelectedIds(new Set());
            }}
            className="fast rounded border border-signal/30 px-2 py-0.5 text-label text-signal hover:bg-signal-soft"
          >
            Trash
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-1 text-label text-muted hover:text-ink"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
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

      {contextMenu && (
        <TaskContextMenu
          task={contextMenu.task}
          x={contextMenu.x}
          y={contextMenu.y}
          now={now}
          vertical={vertical}
          mutations={mutations}
          onSchedule={() => { setSchedulePickerFor(contextMenu.task); setContextMenu(null); }}
          onLabel={() => { setLabelPickerFor(contextMenu.task); setContextMenu(null); }}
          onOpen={() => {
            const el = document.querySelector<HTMLElement>(`[data-task-drag="${contextMenu.task.id}"]`);
            const anchor = el?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40);
            onOpenTask(contextMenu.task, anchor);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
          toggleTaskSprint={toggleTaskSprint}
        />
      )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-3 py-6 text-center text-caption text-muted">{text}</div>;
}

// ── Right-click context menu ───────────────────────────────────────────────
function TaskContextMenu({
  task,
  x,
  y,
  now,
  vertical,
  mutations,
  onSchedule,
  onLabel,
  onOpen,
  onClose,
  toggleTaskSprint,
}: {
  task: Task;
  x: number;
  y: number;
  now: Date;
  vertical: ReturnType<typeof useVertical>["data"];
  mutations: Mutations;
  onSchedule: () => void;
  onLabel: () => void;
  onOpen: (anchor: DOMRect) => void;
  onClose: () => void;
  toggleTaskSprint: (id: string) => void;
}) {
  const [deleteMode, setDeleteMode] = useState(false);
  const { data: recurrences = [] } = useRecurrences();
  const recurrenceMutations = useRecurrenceMutations();
  const recurrence = task.recurrence_id
    ? recurrences.find((r) => r.id === task.recurrence_id) ?? null
    : null;
  const recurring = Boolean(task.recurrence_id && recurrence);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (deleteMode) setDeleteMode(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, deleteMode]);

  const done = task.status === "done";
  const inWeek = Boolean(task.sprint_id && task.sprint_id === vertical.sprint?.id);

  // Clamp to viewport
  const POP_W = 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = x + POP_W > vw - 8 ? vw - POP_W - 8 : x;
  const top = y + 260 > vh - 8 ? vh - 260 - 8 : y;

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
    { kind: "action", label: "Today", key: "E", action: () => { mutations.planFor(task, todayISO(now), TRIAGE_UNDO); onClose(); } },
    { kind: "action", label: "Tomorrow", key: "T", action: () => { mutations.planFor(task, tomorrowISO(), TRIAGE_UNDO); onClose(); } },
    { kind: "action", label: "Next week", key: "W", action: () => { mutations.planFor(task, nextWeekISO(), TRIAGE_UNDO); onClose(); } },
    { kind: "action", label: "Schedule…", key: "S", action: onSchedule },
    ...(task.status !== "inbox" ? [{ kind: "action" as const, label: "Return to inbox", key: "I", action: () => { mutations.backToInbox(task, TRIAGE_UNDO); onClose(); } }] : []),
    ...(task.status === "inbox" && (task.project_id || task.initiative_id || task.domain_id)
      ? [{ kind: "action" as const, label: "File to project", key: "P", action: () => { mutations.fileToProject(task); onClose(); } }]
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
      key: "D",
      action: () => {
        done ? mutations.uncomplete(task) : mutations.complete(task);
        onClose();
      },
    },
    { kind: "action", label: "Label…", key: "#", action: onLabel },
    { kind: "sep" },
    recurring
      ? {
          kind: "action" as const,
          label: "Trash…",
          key: "X",
          danger: true,
          action: () => setDeleteMode(true),
        }
      : {
          kind: "action" as const,
          label: "Trash",
          key: "X",
          danger: true,
          action: () => { mutations.trash(task); onClose(); },
        },
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="rise elev-3 fixed z-50 w-[200px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
        style={{ top, left }}
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
              onClick={item.action}
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
      </div>
    </>,
    document.body,
  );
}

function buildTodaySections(today: Task[], now: Date) {
  const active = today.filter((t) => t.status !== "done");
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
