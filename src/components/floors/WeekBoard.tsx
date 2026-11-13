// The Week Board — the Schedule floor's "which day" altitude. Seven day columns
// on the panel, ruled like the grid (D-190, index.css `.wb-*`); each carries a
// capacity meter (committed effort vs
// the work window) so an over-loaded Monday next to an empty Thursday is
// impossible to miss. You distribute work by dragging chips between days (and
// out of the "Needs a day" tray); precise hour-blocking stays one toggle away on
// the Calendar. Coarse on purpose: dropping a chip on a day sets its do_date and
// drops any time block — the day is the unit here, not the hour.
//
// Desktop-only: it renders inside CalendarPane, which never mounts on mobile.
// Drag is pointer-based (HTML5 DnD is swallowed by the Tauri webview).

import { armDragCancel } from "../../lib/dragCancel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { Button, Dot, IconButton, Input } from "../kit";
import { createPortal } from "react-dom";
import { addDays, format, startOfWeek } from "date-fns";
import type { Slot, Task, UserSettings } from "../../lib/types";
import { fmtDuration, isOverdue, parseDateISO, toDateISO, todayISO } from "../../lib/dates";
import { fmtMins, readDay, toBusyBlocks } from "../../lib/now";
import {
  useInboxTasks,
  usePlannedAnytimeTasks,
  useScheduledTasks,
  useSprintTasks,
  type useTaskMutations,
} from "../../hooks/useTasks";
import { useSlotTasks, useSlots } from "../../hooks/useSlots";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useVertical } from "../../hooks/useVertical";
import { firstDayOfWeek } from "../../hooks/useSettings";
import { deriveSlotTitle } from "../../lib/slots";
import { mergeTaskLists } from "../../lib/taskMerge";
import { taskDomainColor } from "../../lib/vertical";

type Mutations = ReturnType<typeof useTaskMutations>;
const DEFAULT_DUR = 30;
const SLOTS_KEY = "nuvo.weekboard.slots";

/** "6:15a" — the clock at column width. Seven columns can't spare the six
 *  characters of "6:15 AM", and the meridiem still has to survive. */
function clock(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
}

/** A day column's stream, in the order it renders: slot containers and timed
 *  rows interleaved by start, then the untimed ("Anytime") group. */
type DayRow =
  | { kind: "slot"; key: string; at: number; slot: Slot; children: Task[] }
  | { kind: "task"; key: string; at: number; task: Task };

export default function WeekBoard({
  now,
  settings,
  taskAccent,
  mutations,
  onOpenTask,
  resolveDropTask,
}: {
  now: Date;
  settings: UserSettings | undefined;
  taskAccent: (t: Task) => string | null;
  mutations: Mutations;
  onOpenTask: (t: Task, anchor: DOMRect) => void;
  /** Rows the board's own pools don't hold — see `taskById` below. */
  resolveDropTask?: (id: string) => Task | undefined;
}) {
  const today = todayISO(now);
  // Same display preference as FullCalendar / MobileCalendar (default Sun→Sat).
  // Planning week stays Monday in the kernel — this only orders the lanes.
  const weekStartsOn = firstDayOfWeek(settings);
  const [weekStartISO, setWeekStartISO] = useState(() =>
    toDateISO(startOfWeek(now, { weekStartsOn })),
  );
  // If the preference flips (Settings), re-anchor so the board doesn't strand
  // on a Monday-start cursor under a Sunday-start grid (or the reverse).
  useEffect(() => {
    setWeekStartISO(toDateISO(startOfWeek(parseDateISO(weekStartISO), { weekStartsOn })));
    // Only when the preference changes — not on every week walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartsOn]);
  const weekStart = useMemo(() => new Date(weekStartISO + "T00:00:00"), [weekStartISO]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const rangeStart = weekStart.toISOString();
  const rangeEnd = addDays(weekStart, 7).toISOString();

  const { data: scheduled = [] } = useScheduledTasks(rangeStart, rangeEnd);
  const { data: anytime = [] } = usePlannedAnytimeTasks(rangeStart, rangeEnd);
  const { data: slots = [] } = useSlots(rangeStart, rangeEnd);
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);
  const { data: slotChildren = [] } = useSlotTasks(slotIds);
  const slotDayById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) m.set(s.id, s.do_date);
    return m;
  }, [slots]);
  /** A task's day. The slot wins when present — children can briefly carry a
   *  stale do_date after the slot moves, and the left rail already trusts the slot. */
  const taskDay = (t: Task): string | null =>
    (t.slot_id ? slotDayById.get(t.slot_id) ?? null : null)
    ?? t.do_date
    ?? (t.start_time ? toDateISO(new Date(t.start_time)) : null);
  const { data: events = [] } = useExternalEvents(rangeStart, rangeEnd);
  const { data: vertical, setSprintGoal, toggleTaskSprint } = useVertical();
  const sprintId = vertical.sprint?.id ?? null;
  const { data: sprintTasks = [] } = useSprintTasks(sprintId);
  const { data: inbox = [] } = useInboxTasks();

  const hidden = settings?.hidden_calendar_ids ?? [];
  const hiddenEventKeys = (settings?.hidden_events ?? []).map((h) => h.key);
  const workStartMin = settings?.work_start_minutes ?? 480;
  const workEndMin = settings?.work_end_minutes ?? 990;

  // Dated task rows this week (timed + anytime + slot children), keyed by their day.
  // Slot children often have start_time null and can briefly have a stale do_date;
  // the slot is the source of truth for "which day" — same as the Today rail.
  const placed = useMemo(() => {
    const map = new Map<string, Task[]>();
    const seen = new Set<string>();
    for (const t of [...scheduled, ...anytime, ...slotChildren]) {
      if (seen.has(t.id)) continue;
      const day = taskDay(t);
      if (!day) continue;
      seen.add(t.id);
      const arr = map.get(day);
      if (arr) arr.push(t);
      else map.set(day, [t]);
    }
    return map;
  }, [scheduled, anytime, slotChildren, slotDayById]);

  // The "Needs a day" tray: committed-but-unplaced work + anything that slipped
  // (dated before today, still open). Slotted work already has a day — never tray it.
  const tray = useMemo(() => {
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const t of [...sprintTasks, ...scheduled, ...anytime, ...slotChildren]) {
      if (t.status === "done" || seen.has(t.id)) continue;
      const day = taskDay(t);
      // In a slot (or otherwise dated/timed) → placed. Only undated work is loose.
      const loose = !day && !t.start_time && !t.slot_id;
      const overdue = day != null && day < today && !t.slot_id;
      if (loose || overdue) {
        seen.add(t.id);
        out.push(t);
      }
    }
    return out.sort((a, b) => {
      const ad = taskDay(a);
      const bd = taskDay(b);
      const ao = ad != null && ad < today;
      const bo = bd != null && bd < today;
      if (ao !== bo) return ao ? -1 : 1; // overdue first
      return (ad ?? "z").localeCompare(bd ?? "z");
    });
  }, [sprintTasks, scheduled, anytime, slotChildren, slotDayById, today]);

  // Slots as a view, not a fact: off, a slot's children read as ordinary anytime
  // work (what the board always did); on, they nest under their container so the
  // day reads as "this block, then that block" instead of a flat list.
  const [showSlots, setShowSlots] = useState(() => {
    try {
      return localStorage.getItem(SLOTS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SLOTS_KEY, showSlots ? "1" : "0");
    } catch { /* private mode — the toggle just doesn't persist */ }
  }, [showSlots]);

  const slotsByDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const arr = m.get(s.do_date);
      if (arr) arr.push(s);
      else m.set(s.do_date, [s]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return m;
  }, [slots]);

  const childrenBySlot = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of slotChildren) {
      if (!t.slot_id) continue;
      const arr = m.get(t.slot_id);
      if (arr) arr.push(t);
      else m.set(t.slot_id, [t]);
    }
    return m;
  }, [slotChildren]);

  const doneLast = (a: Task, b: Task) => {
    const ad = a.status === "done";
    const bd = b.status === "done";
    if (ad !== bd) return ad ? 1 : -1;
    return 0;
  };

  /** A day column split into what the eye needs: a timed stream (slots + blocks,
   *  in clock order) and the untimed pool underneath it. */
  const dayStream = (iso: string): { timed: DayRow[]; anytime: Task[] } => {
    const list = placed.get(iso) ?? [];
    // Past days show only what actually happened (done); slipped work is in the tray.
    const visible = list.filter((t) => t.status === "done" || iso >= today);
    const daySlots = showSlots ? slotsByDay.get(iso) ?? [] : [];
    const slotIdSet = new Set(daySlots.map((s) => s.id));

    const timed: DayRow[] = [];
    const anytime: Task[] = [];
    for (const t of visible) {
      if (t.slot_id && slotIdSet.has(t.slot_id)) continue; // rendered inside its slot
      if (t.start_time) {
        timed.push({ kind: "task", key: t.id, at: new Date(t.start_time).getTime(), task: t });
      } else {
        anytime.push(t);
      }
    }
    for (const s of daySlots) {
      timed.push({
        kind: "slot",
        key: s.id,
        at: new Date(s.start_time).getTime(),
        slot: s,
        children: (childrenBySlot.get(s.id) ?? [])
          .filter((c) => c.status === "done" || iso >= today)
          .sort(doneLast),
      });
    }
    timed.sort((a, b) => a.at - b.at);
    anytime.sort(doneLast);
    return { timed, anytime };
  };

  const slotTitle = (s: Slot, children: Task[]) => deriveSlotTitle(s, children, vertical);
  const slotAccent = (s: Slot) =>
    s.color ??
    taskDomainColor(vertical, { domain_id: s.domain_id, project_id: s.project_id, initiative_id: null });

  // Committed effort vs the work window. Timed commitments (calendar events +
  // scheduled task blocks) are *merged* via readDay so overlaps don't double-
  // count; anytime tasks add their duration on top (they still want focus time).
  //
  // Deliberately NOT the kernel's `dayLoad` (`_shared/dayShape.ts`), and named
  // apart so the two can't be mistaken for each other (Principle 11). They
  // answer different questions and must keep different answers:
  //   dayCapacity (here)  — how much of your WORK WINDOW is spoken for,
  //                         intentions included. Anytime tasks count; a 7pm
  //                         dinner does not. This is a planning surface: you
  //                         drop unscheduled work onto these columns.
  //   dayLoad (kernel)    — how much of the DAY is claimed by things on a
  //                         clock, evening included, intentions excluded. That
  //                         is what a year grid shades, and what the chat says.
  const dayCapacity = (d: Date) => {
    const ws = new Date(d);
    ws.setHours(0, workStartMin, 0, 0);
    const we = new Date(d);
    we.setHours(0, workEndMin, 0, 0);
    const windowMins = Math.max(60, Math.round((we.getTime() - ws.getTime()) / 60_000));
    const iso = toDateISO(d);
    const dayPlaced = placed.get(iso) ?? [];
    const timed = dayPlaced.filter((t) => t.start_time && t.status !== "done");
    const blocked = windowMins - readDay(ws, toBusyBlocks(events, timed, hidden, hiddenEventKeys), ws, we).openMins;
    const anytimeMins = dayPlaced
      .filter((t) => !t.start_time && t.status !== "done" && iso >= today)
      .reduce((s, t) => s + (t.duration_minutes ?? DEFAULT_DUR), 0);
    const committed = Math.round(blocked + anytimeMins);
    return { committed, windowMins, open: Math.max(0, windowMins - committed), over: committed > windowMins };
  };

  // ── Unified pointer drag (Tauri-safe, no HTML5 DnD) ───────────────────────
  // One gesture handles every source/target: any [data-task-drag] row — a board
  // chip OR a left-rail row (Inbox / Today) — can be dropped on a day column
  // ([data-day]), the "Needs a day" tray ([data-tray] → keep the week, drop the
  // day), or back into the rail ([data-rail-drop] → Inbox). A plain click on a
  // board chip (no movement) opens it; clicks on rail rows fall through to the
  // rail's own handlers.
  // Ghost identity is state (set once per grab); its position is a direct
  // transform write per rAF — same pattern as Sheet.tsx / OnDeckPlanner, so a
  // 120Hz pointer can't out-run the frame budget.
  const [drag, setDrag] = useState<{ task: Task } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostPos = useRef({ x: 0, y: 0 });
  const ghostTransform = (x: number, y: number) => `translate3d(${x + 12}px, ${y + 10}px, 0)`;
  type DropTarget = { kind: "day"; day: string } | { kind: "tray" } | { kind: "inbox" } | null;
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Resolve any draggable id → its Task across every pool the board can touch.
  const taskById = useMemo(
    () => mergeTaskLists([inbox, sprintTasks, scheduled, anytime, slotChildren]),
    [inbox, sprintTasks, scheduled, anytime, slotChildren],
  );

  // The board grabs ANY `[data-task-drag]` row in the rail, including the week
  // crown's loose project work — which is in none of the pools above (no
  // `do_date`, no `start_time`, no `sprint_id`). Without the fallback the
  // gesture bailed at `if (!task) return` and the row simply refused to move.
  const resolve = useCallback(
    (id: string) => taskById.get(id) ?? resolveDropTask?.(id),
    [taskById, resolveDropTask],
  );

  // Latest values for the (mount-once) document listener to read without resubscribing.
  const live = useRef({ resolve, mutations, toggleTaskSprint, sprintId, onOpenTask });
  live.current = { resolve, mutations, toggleTaskSprint, sprintId, onOpenTask };

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement)?.closest?.("[data-task-drag]") as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute("data-task-drag");
      const task = id ? live.current.resolve(id) : null;
      if (!task) return;
      const fromBoard = Boolean(boardRef.current?.contains(el));
      const rail = document.querySelector<HTMLElement>("[data-rail-drop]");
      const fromRail = Boolean(rail?.contains(el));
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      let target: DropTarget = null;

      // Kill text selection the instant the item is grabbed — before any drag
      // pixels, so the browser never starts a selection to begin with. (Setting
      // it only after the move threshold is too late: a selection already
      // started can't be cancelled by user-select.)
      document.body.classList.add("wb-noselect");
      window.getSelection()?.removeAllRanges();

      // rAF-coalesced: stash the latest pointer event, derive once per frame,
      // and only touch React state when the drop target actually changed.
      let lastEv: PointerEvent | null = null;
      let raf = 0;
      let prevTargetKey = "";

      const flush = () => {
        raf = 0;
        const ev = lastEv;
        if (!ev) return;
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        if (!moved) {
          moved = true;
          document.body.style.cursor = "grabbing";
          setDrag({ task });
        }
        ghostPos.current = { x: ev.clientX, y: ev.clientY };
        if (ghostRef.current) ghostRef.current.style.transform = ghostTransform(ev.clientX, ev.clientY);
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const dayEl = hit?.closest("[data-day]");
        if (dayEl) target = { kind: "day", day: dayEl.getAttribute("data-day") ?? "" };
        else if (hit?.closest("[data-tray]")) target = { kind: "tray" };
        // A row already in the rail is the rail's own business — LeftRail's
        // reorder hook owns its tab-strip acts, chip and Undo included.
        else if (hit?.closest("[data-rail-drop]")) target = fromRail ? null : { kind: "inbox" };
        else target = null;
        const key = target ? (target.kind === "day" ? `day:${target.day}` : target.kind) : "";
        if (key !== prevTargetKey) {
          prevTargetKey = key;
          setDropTarget(target);
          rail?.classList.toggle("rail-drop-active", !fromRail && target?.kind === "inbox");
        }
      };
      const move = (ev: PointerEvent) => {
        lastEv = ev;
        if (!raf) raf = requestAnimationFrame(flush);
      };
      let cancelled = false;
      let disarm = () => {};
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        flush(); // land the drop on the last pointer position, not the last painted frame
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
        rail?.classList.remove("rail-drop-active");
        disarm();
        if (cancelled) target = null;
        const s = live.current;
        if (!moved) {
          if (fromBoard) s.onOpenTask(task, el.getBoundingClientRect());
        } else if (
          target?.kind === "day" &&
          target.day &&
          // A slot child can already carry the target day while living in a
          // slot — moving it out is still a real change, so don't no-op it.
          (target.day !== task.do_date || task.slot_id)
        ) {
          s.mutations.planFor(task, target.day);
        } else if (target?.kind === "tray") {
          // Keep it in the week, just drop the day — and make sure it's committed
          // so it actually lands in the tray's pool.
          if (s.sprintId && task.sprint_id !== s.sprintId) s.toggleTaskSprint(task.id);
          s.mutations.backToWeek(task);
        } else if (target?.kind === "inbox") {
          s.mutations.backToInbox(task);
        }
        setDrag(null);
        setDropTarget(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      // Esc / ⌘Tab / an OS cancel ends the drag with nothing written.
      disarm = armDragCancel(() => {
        cancelled = true;
        if (moved) { up(); return; }
        // Not yet a drag: just stand down — never open the card on an Esc.
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
      });
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  const hoverDay = dropTarget?.kind === "day" ? dropTarget.day : null;

  const walk = (delta: number) =>
    setWeekStartISO((iso) => toDateISO(addDays(new Date(iso + "T00:00:00"), delta)));
  const resetToThisWeek = () => setWeekStartISO(toDateISO(startOfWeek(now, { weekStartsOn })));
  const thisWeekISO = toDateISO(startOfWeek(now, { weekStartsOn }));

  const weekLabel = useMemo(() => {
    const s = weekStart;
    const e = addDays(s, 6);
    return `${format(s, "MMM d")} – ${format(e, s.getMonth() === e.getMonth() ? "d" : "MMM d")}`;
  }, [weekStart]);

  return (
    <div ref={boardRef} className="flex min-h-0 flex-1 flex-col">
      {/* The board's own week walk — the PageBar above names the page (Spread)
          and steps aside; the span on screen is this row's one line. */}
      <div className="wb-bar">
        <span className="wb-span">{weekLabel}</span>
        <IconButton label="Previous week" icon={<Icon name="chevron-left" size={14} />} onClick={() => walk(-7)} />
        <IconButton label="Next week" icon={<Icon name="chevron-right" size={14} />} onClick={() => walk(7)} />
        {weekStartISO !== thisWeekISO && <Button onClick={resetToThisWeek}>This week</Button>}
        {slots.length > 0 && (
          <Button
            active={showSlots}
            aria-pressed={showSlots}
            onClick={() => setShowSlots((s) => !s)}
            title={showSlots ? "Show a flat day — no slot grouping" : "Group each day by its slots"}
          >
            Slots
          </Button>
        )}
        <div className="min-w-2 flex-1" />
        {/* The week's goal + the ring that only ever fills — absorbed from the
            old Week tab, the one thing the board didn't already carry. */}
        <WeekGoal goal={vertical.sprintGoal ?? ""} onCommit={setSprintGoal} tasks={sprintTasks} />
      </div>

      {/* Needs a day — the loose + slipped pool you distribute onto the week. Also
          a drop target: drag a placed task back here to keep it in the week
          without a day ("this week, just not yet"). Shown whenever it has items,
          and revealed during any drag so it's always a reachable target. */}
      {(tray.length > 0 || drag) && (
        <div data-tray className="wb-tray" data-over={dropTarget?.kind === "tray" || undefined}>
          <span className="wb-tray-label">
            Needs a day <span className="wb-count">{tray.length}</span>
          </span>
          {/* A uniform grid, not a flow: equal cells wrap to two rows, then
              scroll, so titles read in full and the ones that don't line up. */}
          <div
            className="grid max-h-[164px] min-w-0 flex-1 gap-2 overflow-y-auto"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))" }}
          >
            {tray.map((t) => (
              <TrayChip key={t.id} t={t} today={today} accent={taskAccent(t)} />
            ))}
          </div>
        </div>
      )}

      {/* Seven lanes, not seven cards: each column is a stretch of the panel
          between day rules, so the only framed things on the board are the
          cards, and they get to float. */}
      <div className="grid min-h-0 flex-1 grid-cols-7">
        {days.map((d) => {
          const iso = toDateISO(d);
          const isToday = iso === today;
          const isPast = iso < today;
          const load = dayCapacity(d);
          const { timed, anytime } = dayStream(iso);
          const empty = timed.length === 0 && anytime.length === 0;
          const hovered = hoverDay === iso;
          return (
            <div
              key={iso}
              data-day={isPast ? undefined : iso}
              className="wb-day"
              data-today={isToday || undefined}
              data-past={isPast || undefined}
              data-over={hovered || undefined}
            >
              <div className="cal-dayhead" data-today={isToday || undefined}>
                <span className="cal-dayhead-dow">{format(d, "EEE")}</span>
                <span className="cal-daynum">{format(d, "d")}</span>
              </div>

              <Meter load={load} isPast={isPast} />

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-2">
                {/* Anytime — dated to this day, but not to an hour. It sits ABOVE
                    the timed stream, the same place the Week grid puts its
                    anytime row: one concept can't be above the clock in one view
                    and below it in another. A rule closes the lane. */}
                {anytime.length > 0 && (
                  <>
                    <div className="wb-lane-label">
                      <span>Anytime</span>
                      <span className="wb-rule" />
                    </div>
                    {anytime.map((t) => (
                      <TaskCard key={t.id} t={t} now={now} accent={taskAccent(t)} />
                    ))}
                    {timed.length > 0 && <div className="wb-rule wb-rule-gap" />}
                  </>
                )}

                {timed.map((row) =>
                  row.kind === "slot" ? (
                    <SlotCard
                      key={row.key}
                      slot={row.slot}
                      title={slotTitle(row.slot, row.children)}
                      items={row.children}
                      accent={slotAccent(row.slot)}
                    />
                  ) : (
                    <TaskCard key={row.key} t={row.task} now={now} accent={taskAccent(row.task)} />
                  ),
                )}

                {/* Empty is a state, not the absence of one — and the two cases
                    mean different things: an empty Thursday next week is an
                    invitation (a socket you can drop into), an empty Sunday last
                    week is a record (past days aren't drop targets). */}
                {empty &&
                  (isPast ? (
                    <div className="wb-empty-past">Nothing kept</div>
                  ) : (
                    <div className="wb-socket" data-over={hovered || undefined} style={{ height: CARD_H }}>
                      {hovered ? "Drop here" : "Nothing planned"}
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {drag &&
        createPortal(
          <div
            ref={ghostRef}
            className="wb-ghost"
            style={{ transform: ghostTransform(ghostPos.current.x, ghostPos.current.y), willChange: "transform" }}
          >
            {drag.task.title}
          </div>,
          document.body,
        )}
    </div>
  );
}

function Meter({
  load,
  isPast,
}: {
  load: { committed: number; windowMins: number; open: number; over: boolean };
  isPast: boolean;
}) {
  if (isPast) return <div className="wb-meter" aria-hidden />;
  const pct = Math.min(100, Math.round((load.committed / load.windowMins) * 100));
  return (
    // Committed effort against the work window: a 3px track, a neutral fill,
    // `--warn` past capacity. What's left is open time, so it reads --slot.
    <div className="wb-meter" data-over={load.over || undefined}>
      <div className="wb-track">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="wb-load" data-state={load.over ? "over" : load.committed === 0 ? "clear" : "open"}>
        {load.over ? `${fmtMins(load.committed)} · over` : load.committed === 0 ? "Clear" : `${fmtMins(load.open)} open`}
      </div>
    </div>
  );
}

/**
 * ── The card, and the only card ────────────────────────────────────────────
 * One shape carries every piece of work on this board — a day's task, a slot,
 * a tray item: the kit's card (raised, one hairline, --sh-1). Its height never
 * depends on its content: the title gets a reserved three-line box and the
 * meta a reserved line, so seven columns read as one week instead of seven
 * ragged lists.
 */
const CARD_H = 74;

function TaskCard({
  t,
  now,
  accent,
}: {
  t: Task;
  now: Date;
  accent: string | null;
}) {
  const done = t.status === "done";
  const late = !done && isOverdue(t, now);
  return (
    <div data-task-drag={t.id} className="wb-card" data-done={done || undefined} style={{ height: CARD_H }} title={t.title}>
      <div className="wb-title">{t.title}</div>
      <div className="wb-meta">
        {accent && <Dot color={accent} size="sm" />}
        {/* Late is the one --signal on a card (the rail's rule): the time it
            was meant for, in the ember. */}
        {t.start_time && <span className={late ? "wb-late" : undefined}>{clock(t.start_time)}</span>}
        {t.start_time && t.duration_minutes ? <span>·</span> : null}
        {t.duration_minutes ? <span>{fmtDuration(t.duration_minutes)}</span> : null}
      </div>
    </div>
  );
}

/** A slot is one thing on the week, not a folder you read through: the card,
 *  hatched like the grid's slot, naming the container and how full it is.
 *  What's inside is a Day-view question — flip Slots off and every child comes
 *  back as its own card. */
function SlotCard({
  slot,
  title,
  items,
  accent,
}: {
  slot: Slot;
  title: string;
  items: Task[];
  accent: string | null;
}) {
  const done = items.filter((t) => t.status === "done").length;
  return (
    <div
      className="wb-card"
      data-slot=""
      style={{ height: CARD_H, ["--evt-hue" as string]: accent ?? "var(--slot)" }}
      title={items.length > 0 ? `${title}\n${items.map((t) => `· ${t.title}`).join("\n")}` : title}
    >
      <div className="wb-title">{title}</div>
      <div className="wb-meta">
        <span>{clock(slot.start_time)}</span>
        {items.length > 0 && <span>· {done}/{items.length}</span>}
      </div>
    </div>
  );
}

/** The same card, in a uniform grid. The tray is where you decide *which* task
 *  to place, so the title keeps its lines — one line at this width renders
 *  "Freedom Discipleship Curric…" for two different tasks. */
function TrayChip({
  t,
  today,
  accent,
}: {
  t: Task;
  today: string;
  accent: string | null;
}) {
  const overdue = t.do_date != null && t.do_date < today;
  return (
    <div data-task-drag={t.id} className="wb-card min-w-0" style={{ height: CARD_H }} title={`${t.title}${overdue ? " — overdue" : ""}`}>
      <div className="wb-title">{t.title}</div>
      <div className="wb-meta">
        {accent && <Dot color={accent} size="sm" />}
        {overdue && <span className="wb-late">overdue</span>}
        {overdue && t.duration_minutes ? <span>·</span> : null}
        {t.duration_minutes ? <span>{fmtDuration(t.duration_minutes)}</span> : null}
      </div>
    </div>
  );
}

/** The week's goal + the ring that only ever fills (against committed hours,
 *  not infinity) — the one element carried over from the retired Week tab. */
function WeekGoal({
  goal,
  onCommit,
  tasks,
}: {
  goal: string;
  onCommit: (v: string) => void;
  tasks: Task[];
}) {
  const [draft, setDraft] = useState(goal);
  useEffect(() => setDraft(goal), [goal]);
  const total = tasks.reduce((s, t) => s + (t.duration_minutes ?? DEFAULT_DUR), 0);
  const done = tasks
    .filter((t) => t.status === "done")
    .reduce((s, t) => s + (t.duration_minutes ?? DEFAULT_DUR), 0);
  const pct = total > 0 ? done / total : 0;
  const r = 8;
  const c = 2 * Math.PI * r;
  const said = `${Math.round(pct * 100)}% of committed hours done`;
  return (
    <div className="flex items-center gap-2">
      <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90 shrink-0" role="img" aria-label={said}>
        <title>{said}</title>
        <circle cx="10" cy="10" r={r} fill="none" stroke="var(--line-2)" strokeWidth="2.5" />
        <circle
          cx="10" cy="10" r={r} fill="none"
          stroke="var(--landed, var(--accent))" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset var(--d-slow) var(--ease-out)" }}
        />
      </svg>
      <span className="wb-pct">{Math.round(pct * 100)}%</span>
      <Input
        size="sm"
        frameClassName="w-[260px]"
        aria-label="This week's goal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== goal && onCommit(draft)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="What does a good week look like?"
      />
    </div>
  );
}
