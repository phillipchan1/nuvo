// The Week Board — the Schedule floor's "which day" altitude. Seven day columns
// on the warm-paper canvas; each carries a capacity meter (committed effort vs
// the work window) so an over-loaded Monday next to an empty Thursday is
// impossible to miss. You distribute work by dragging chips between days (and
// out of the "Needs a day" tray); precise hour-blocking stays one toggle away on
// the Calendar. Coarse on purpose: dropping a chip on a day sets its do_date and
// drops any time block — the day is the unit here, not the hour.
//
// Desktop-only: it renders inside CalendarPane, which never mounts on mobile.
// Drag is pointer-based (HTML5 DnD is swallowed by the Tauri webview).

import { useEffect, useMemo, useRef, useState } from "react";
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
}: {
  now: Date;
  settings: UserSettings | undefined;
  taskAccent: (t: Task) => string | null;
  mutations: Mutations;
  onOpenTask: (t: Task, anchor: DOMRect) => void;
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
  const dayLoad = (d: Date) => {
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
  const [drag, setDrag] = useState<{ task: Task; x: number; y: number } | null>(null);
  type DropTarget = { kind: "day"; day: string } | { kind: "tray" } | { kind: "inbox" } | null;
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Resolve any draggable id → its Task across every pool the board can touch.
  const taskById = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of [...inbox, ...sprintTasks, ...scheduled, ...anytime, ...slotChildren]) m.set(t.id, t);
    return m;
  }, [inbox, sprintTasks, scheduled, anytime, slotChildren]);

  // Latest values for the (mount-once) document listener to read without resubscribing.
  const live = useRef({ taskById, mutations, toggleTaskSprint, sprintId, onOpenTask });
  live.current = { taskById, mutations, toggleTaskSprint, sprintId, onOpenTask };

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement)?.closest?.("[data-task-drag]") as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute("data-task-drag");
      const task = id ? live.current.taskById.get(id) : null;
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

      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        if (!moved) {
          moved = true;
          document.body.style.cursor = "grabbing";
        }
        setDrag({ task, x: ev.clientX, y: ev.clientY });
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const dayEl = hit?.closest("[data-day]");
        if (dayEl) target = { kind: "day", day: dayEl.getAttribute("data-day") ?? "" };
        else if (hit?.closest("[data-tray]")) target = { kind: "tray" };
        // A row already in the rail is the rail's own business — LeftRail's
        // reorder hook owns its tab-strip acts, chip and Undo included.
        else if (hit?.closest("[data-rail-drop]")) target = fromRail ? null : { kind: "inbox" };
        else target = null;
        setDropTarget(target);
        rail?.classList.toggle("rail-drop-active", !fromRail && target?.kind === "inbox");
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
        rail?.classList.remove("rail-drop-active");
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
      {/* Header — the board's own week walk; the Calendar toggle lives in the toolbar above. */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-1">
        <span className="masthead text-lead leading-none text-text">The Week</span>
        <span className="text-caption text-muted">{weekLabel}</span>
        <div className="ml-1 flex items-center gap-0.5">
          <button
            onClick={() => walk(-7)}
            className="fast flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
            title="Previous week"
            aria-label="Previous week"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => walk(7)}
            className="fast flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
            title="Next week"
            aria-label="Next week"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {weekStartISO !== thisWeekISO && (
          <button
            onClick={resetToThisWeek}
            className="fast rounded border border-line px-2 py-0.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
          >
            This week
          </button>
        )}
        {slots.length > 0 && (
          <button
            onClick={() => setShowSlots((s) => !s)}
            aria-pressed={showSlots}
            title={showSlots ? "Show a flat day — no slot grouping" : "Group each day by its slots"}
            className="fast rounded-full border px-2 py-0.5 text-label font-medium"
            style={{
              borderColor: showSlots ? "var(--accent)" : "var(--line)",
              color: showSlots ? "var(--accent)" : "var(--muted)",
              background: showSlots ? "var(--accent-soft)" : "transparent",
            }}
          >
            Slots
          </button>
        )}
        <div className="flex-1" />
        {/* The week's goal + the ring that only ever fills — absorbed from the
            old Week tab, the one thing the board didn't already carry. */}
        <WeekGoal goal={vertical.sprintGoal ?? ""} onCommit={setSprintGoal} tasks={sprintTasks} />
      </div>

      {/* Needs a day — the loose + slipped pool you distribute onto the week. Also
          a drop target: drag a placed task back here to keep it in the week
          without a day ("this week, just not yet"). Shown whenever it has items,
          and revealed during any drag so it's always a reachable target. */}
      {(tray.length > 0 || drag) && (
        <div
          data-tray
          className="mx-4 mb-3 flex shrink-0 items-start gap-2 rounded-xl border border-dashed px-3 py-2 transition-colors"
          style={{
            borderColor: dropTarget?.kind === "tray" ? "var(--accent)" : "var(--line-strong)",
            background: dropTarget?.kind === "tray" ? "var(--accent-soft)" : "color-mix(in srgb, var(--surface) 30%, transparent)",
          }}
        >
          <span className="section-label !p-0 shrink-0 pt-1">Needs a day · {tray.length}</span>
          {/* A uniform grid, not a flow: equal cells wrap to two rows, then
              scroll. Cells are ~2× the old truncation width, so most titles read
              in full — and the ones that don't at least line up. */}
          <div
            className="grid max-h-[156px] min-w-0 flex-1 gap-2 overflow-y-auto"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))" }}
          >
            {tray.map((t) => (
              <TrayChip key={t.id} t={t} today={today} accent={taskAccent(t)} />
            ))}
          </div>
          <span className="shrink-0 whitespace-nowrap pl-2 pt-1 text-meta text-muted">
            {drag ? "drop here to keep it this week, no day" : "drag onto a day →"}
          </span>
        </div>
      )}

      {/* Seven lanes, not seven cards. The column is a transparent stretch of the
          same warm paper, separated by a hairline — so the only framed things on
          the board are the cards, and they get to float. (A bordered column
          holding bordered cards is boxes-in-boxes; that's what read as crowded.) */}
      <div className="grid min-h-0 flex-1 grid-cols-7 px-2 pb-3">
        {days.map((d, i) => {
          const iso = toDateISO(d);
          const isToday = iso === today;
          const isPast = iso < today;
          const load = dayLoad(d);
          const { timed, anytime } = dayStream(iso);
          const empty = timed.length === 0 && anytime.length === 0;
          const hovered = hoverDay === iso;
          return (
            <div
              key={iso}
              data-day={isPast ? undefined : iso}
              className="flex min-h-0 flex-col px-1.5 pb-1.5 pt-2"
              style={{
                borderRight: i < 6 ? "1px solid var(--line)" : undefined,
                background: hovered
                  ? "var(--accent-soft)"
                  : isToday
                    ? "color-mix(in srgb, var(--signal) 5%, transparent)"
                    : undefined,
                opacity: isPast ? 0.5 : 1,
              }}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className="text-body font-semibold"
                  style={{ color: isToday ? "var(--signal)" : "var(--ink)" }}
                >
                  {format(d, "EEE d")}
                </span>
                {isToday && (
                  <span className="text-micro uppercase tracking-wide text-signal">today</span>
                )}
              </div>

              <Meter load={load} isPast={isPast} isToday={isToday} />

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-2">
                {/* Anytime — dated to this day, but not to an hour. It sits ABOVE
                    the timed stream, the same place the Week grid puts its
                    all-day lane (FullCalendar `allDaySlot`, labelled "anytime"):
                    one concept can't be above the clock in one view and below it
                    in another. A rule closes the lane before the day's hours. */}
                {anytime.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="text-micro uppercase tracking-wide text-muted">Anytime</span>
                      <span className="h-px flex-1" style={{ background: "var(--line)" }} />
                    </div>
                    {anytime.map((t) => (
                      <TaskCard key={t.id} t={t} now={now} accent={taskAccent(t)} />
                    ))}
                    {timed.length > 0 && (
                      <div style={{ marginTop: 12, height: 1, background: "var(--line)" }} />
                    )}
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

                {!isPast && empty && (
                  <div
                    className="flex items-center justify-center rounded-lg border border-dashed text-caption"
                    style={{
                      height: CARD_H,
                      borderColor: hovered ? "var(--accent)" : "var(--line)",
                      color: hovered ? "var(--accent)" : "var(--muted)",
                    }}
                  >
                    {hovered ? "drop here" : "—"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {drag &&
        createPortal(
          <div
            className="glass-grab pointer-events-none fixed z-[100] max-w-[220px] truncate rounded-md px-2 py-1.5 text-caption text-ink"
            style={{ left: drag.x + 12, top: drag.y + 10 }}
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
  isToday,
}: {
  load: { committed: number; windowMins: number; open: number; over: boolean };
  isPast: boolean;
  isToday: boolean;
}) {
  if (isPast) return <div className="mb-2.5 mt-1 px-0.5 text-caption text-muted/50">—</div>;
  const pct = Math.min(100, Math.round((load.committed / load.windowMins) * 100));
  const fill = load.over ? "var(--signal)" : isToday ? "var(--signal)" : "var(--muted)";
  return (
    <div className="mb-2.5 mt-2 px-0.5">
      <div className="flex h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <span style={{ width: `${pct}%`, background: fill }} />
      </div>
      <div
        className="mt-1.5 text-caption"
        style={{ color: load.over ? "var(--signal)" : load.committed === 0 ? "var(--muted)" : "var(--slot)" }}
      >
        {load.over ? `${fmtMins(load.committed)} · over` : load.committed === 0 ? "clear" : `${fmtMins(load.open)} open`}
      </div>
    </div>
  );
}

/**
 * ── The card, and the only card ────────────────────────────────────────────
 * One shape carries every piece of work on this board — a day's task, a slot,
 * a tray item. It floats on the paper (the lane behind it is transparent), and
 * its height never depends on its content: the title gets a reserved two-line
 * box and the meta a reserved line, so a short title and a long one occupy the
 * same rectangle. That fixed rectangle is what lets seven columns read as one
 * week instead of seven ragged lists.
 */
const CARD_H = 74;
const CARD_BASE =
  "fast relative cursor-pointer touch-none select-none rounded-lg border border-line bg-surface px-1.5 py-1.5 hover:border-line-strong";
// Three lines, not two: at column width half of all titles clip at two, and
// only a fifth clip at three. Shrinking the type instead barely moves it
// (50%→42%) — the line count is the lever. 12px costs nothing at three lines
// and shows ~6 more characters than 13px would.
const TITLE_BOX = "line-clamp-3 h-[45px] text-caption leading-[15px]";

const META_LINE = "mono mt-0.5 h-[13px] truncate text-meta leading-[13px] text-muted";

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
  const overdueTimed = !done && isOverdue(t, now);
  const meta = [
    t.start_time ? clock(t.start_time) : null,
    t.duration_minutes ? fmtDuration(t.duration_minutes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      data-task-drag={t.id}
      className={CARD_BASE}
      style={{ height: CARD_H, boxShadow: accent ? `inset 3px 0 0 0 ${accent}` : undefined }}
      title={t.title}
    >
      <div
        className={TITLE_BOX}
        style={{
          textDecoration: done ? "line-through" : undefined,
          color: done ? "var(--muted)" : overdueTimed ? "var(--signal)" : "var(--ink)",
        }}
      >
        {t.title}
      </div>
      <div className={META_LINE}>{meta}</div>
    </div>
  );
}

/** A slot is one thing on the week, not a folder you read through: the same
 *  card, naming the container and how full it is, drawn as a small stack of
 *  paper. What's inside is a Day-view question — flip Slots off and every child
 *  comes back as its own card. */
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
  const hue = accent ?? "var(--slot)";
  return (
    <div
      className={`${CARD_BASE} mb-1`}
      style={{
        height: CARD_H,
        // The stack tell: two offset copies peeking out below, so a container
        // reads as "several things" before you've read a word of it.
        boxShadow: `inset 3px 0 0 0 ${hue}, 0 3px 0 -1px var(--surface), 0 4px 0 -1px var(--line)`,
      }}
      title={items.length > 0 ? `${title}\n${items.map((t) => `· ${t.title}`).join("\n")}` : title}
    >
      <div className={`${TITLE_BOX} font-medium text-ink`}>{title}</div>
      <div className={META_LINE}>
        {clock(slot.start_time)}
        {items.length > 0 && ` · ${done}/${items.length}`}
      </div>
    </div>
  );
}

/** The same card, in a uniform grid. The tray is where you decide *which* task
 *  to place, so the title keeps both its lines — one line at this width renders
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
    <div
      data-task-drag={t.id}
      className={`${CARD_BASE} min-w-0`}
      style={{
        height: CARD_H,
        borderColor: overdue ? "var(--signal-soft)" : undefined,
        boxShadow: accent ? `inset 3px 0 0 0 ${accent}` : undefined,
      }}
      title={`${t.title}${overdue ? " — overdue" : ""}`}
    >
      <div className={TITLE_BOX} style={{ color: overdue ? "var(--signal)" : "var(--ink)" }}>
        {t.title}
      </div>
      <div className={META_LINE}>
        {[overdue ? "overdue" : null, t.duration_minutes ? fmtDuration(t.duration_minutes) : null]
          .filter(Boolean)
          .join(" · ")}
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
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-7 w-7 shrink-0" title={`${Math.round(pct * 100)}% of committed hours done`}>
        <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
          <circle cx="14" cy="14" r={r} fill="none" stroke="var(--line)" strokeWidth="2.5" />
          <circle
            cx="14" cy="14" r={r} fill="none"
            stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset 300ms ease-out" }}
          />
        </svg>
        <span className="mono absolute inset-0 flex items-center justify-center text-micro text-muted">
          {Math.round(pct * 100)}
        </span>
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== goal && onCommit(draft)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="What does a good week look like?"
        className="w-[260px] bg-transparent text-caption font-medium outline-none placeholder:text-muted/60"
      />
    </div>
  );
}
