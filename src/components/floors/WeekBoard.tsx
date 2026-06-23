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
import type { Task, UserSettings } from "../../lib/types";
import { fmtDuration, fmtTime, isOverdue, toDateISO, todayISO } from "../../lib/dates";
import { fmtMins, readDay, toBusyBlocks } from "../../lib/now";
import {
  useInboxTasks,
  usePlannedAnytimeTasks,
  useScheduledTasks,
  useSprintTasks,
  type useTaskMutations,
} from "../../hooks/useTasks";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useVertical } from "../../hooks/useVertical";

type Mutations = ReturnType<typeof useTaskMutations>;
const DEFAULT_DUR = 30;

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
  const [weekStartISO, setWeekStartISO] = useState(() =>
    toDateISO(startOfWeek(now, { weekStartsOn: 1 })),
  );
  const weekStart = useMemo(() => new Date(weekStartISO + "T00:00:00"), [weekStartISO]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const rangeStart = weekStart.toISOString();
  const rangeEnd = addDays(weekStart, 7).toISOString();

  const { data: scheduled = [] } = useScheduledTasks(rangeStart, rangeEnd);
  const { data: anytime = [] } = usePlannedAnytimeTasks(rangeStart, rangeEnd);
  const { data: events = [] } = useExternalEvents(rangeStart, rangeEnd);
  const { data: vertical, setSprintGoal, toggleTaskSprint } = useVertical();
  const sprintId = vertical.sprint?.id ?? null;
  const { data: sprintTasks = [] } = useSprintTasks(sprintId);
  const { data: inbox = [] } = useInboxTasks();

  const hidden = settings?.hidden_calendar_ids ?? [];
  const workStartMin = settings?.work_start_minutes ?? 480;
  const workEndMin = settings?.work_end_minutes ?? 990;

  // Dated task rows this week (timed + anytime), keyed by their day.
  const placed = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of [...scheduled, ...anytime]) {
      const day = t.do_date ?? (t.start_time ? toDateISO(new Date(t.start_time)) : null);
      if (!day) continue;
      const arr = map.get(day);
      if (arr) arr.push(t);
      else map.set(day, [t]);
    }
    return map;
  }, [scheduled, anytime]);

  // The "Needs a day" tray: committed-but-unplaced work + anything that slipped
  // (dated before today, still open). Both want a day — drag them onto one.
  const tray = useMemo(() => {
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const t of [...sprintTasks, ...scheduled, ...anytime]) {
      if (t.status === "done" || seen.has(t.id)) continue;
      const loose = !t.do_date && !t.start_time;
      const overdue = t.do_date != null && t.do_date < today;
      if (loose || overdue) {
        seen.add(t.id);
        out.push(t);
      }
    }
    return out.sort((a, b) => {
      const ao = a.do_date != null && a.do_date < today;
      const bo = b.do_date != null && b.do_date < today;
      if (ao !== bo) return ao ? -1 : 1; // overdue first
      return (a.do_date ?? "z").localeCompare(b.do_date ?? "z");
    });
  }, [sprintTasks, scheduled, anytime, today]);

  const dayTasks = (iso: string): Task[] => {
    const list = placed.get(iso) ?? [];
    // Past days show only what actually happened (done); slipped work is in the tray.
    const visible = list.filter((t) => t.status === "done" || iso >= today);
    return visible.sort((a, b) => {
      const ad = a.status === "done";
      const bd = b.status === "done";
      if (ad !== bd) return ad ? 1 : -1; // done last
      const at = a.start_time ? new Date(a.start_time).getTime() : Infinity;
      const bt = b.start_time ? new Date(b.start_time).getTime() : Infinity;
      return at - bt; // timed first, by start; anytime trails
    });
  };

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
    const blocked = windowMins - readDay(ws, toBusyBlocks(events, timed, hidden), ws, we).openMins;
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
    for (const t of [...inbox, ...sprintTasks, ...scheduled, ...anytime]) m.set(t.id, t);
    return m;
  }, [inbox, sprintTasks, scheduled, anytime]);

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
        else if (hit?.closest("[data-rail-drop]")) target = { kind: "inbox" };
        else target = null;
        setDropTarget(target);
        rail?.classList.toggle("rail-drop-active", target?.kind === "inbox");
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
        } else if (target?.kind === "day" && target.day && target.day !== task.do_date) {
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
  const resetToThisWeek = () => setWeekStartISO(toDateISO(startOfWeek(now, { weekStartsOn: 1 })));

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
        {weekStartISO !== toDateISO(startOfWeek(now, { weekStartsOn: 1 })) && (
          <button
            onClick={resetToThisWeek}
            className="fast rounded border border-line px-2 py-0.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
          >
            This week
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
          className="mx-4 mb-3 flex shrink-0 items-center gap-2 overflow-x-auto rounded-xl border border-dashed px-3 py-2 transition-colors"
          style={{
            borderColor: dropTarget?.kind === "tray" ? "var(--accent)" : "var(--line-strong)",
            background: dropTarget?.kind === "tray" ? "var(--accent-soft)" : "color-mix(in srgb, var(--surface) 30%, transparent)",
          }}
        >
          <span className="section-label !p-0 shrink-0">Needs a day · {tray.length}</span>
          {tray.map((t) => (
            <TrayChip key={t.id} t={t} now={now} today={today} accent={taskAccent(t)} />
          ))}
          <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-meta text-muted">
            {drag ? "drop here to keep it this week, no day" : "drag onto a day →"}
          </span>
        </div>
      )}

      {/* Seven columns — transparent over the atmosphere, hairline-separated. */}
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-2 px-4 pb-3">
        {days.map((d) => {
          const iso = toDateISO(d);
          const isToday = iso === today;
          const isPast = iso < today;
          const load = dayLoad(d);
          const tasks = dayTasks(iso);
          const hovered = hoverDay === iso;
          return (
            <div
              key={iso}
              data-day={isPast ? undefined : iso}
              className="flex min-h-0 flex-col rounded-lg border px-2 pb-1.5 pt-2.5"
              style={{
                borderColor: hovered ? "var(--accent)" : isToday ? "var(--signal-soft)" : "var(--line)",
                background: hovered
                  ? "var(--accent-soft)"
                  : isToday
                    ? "color-mix(in srgb, var(--surface) 72%, transparent)"
                    : isPast
                      ? "transparent"
                      : "color-mix(in srgb, var(--surface) 40%, transparent)",
                boxShadow: isToday && !hovered ? "var(--shadow-lift)" : undefined,
                opacity: isPast ? 0.62 : 1,
              }}
            >
              <div className="flex items-baseline justify-between px-0.5">
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

              <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                {tasks.map((t) => (
                  <TaskChip key={t.id} t={t} now={now} accent={taskAccent(t)} />
                ))}
                {!isPast && tasks.length === 0 && (
                  <div
                    className="mt-1 rounded-lg border border-dashed py-4 text-center text-caption"
                    style={{
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

function TaskChip({
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
  return (
    <div
      data-task-drag={t.id}
      className="fast group mb-2 cursor-pointer touch-none select-none rounded-lg border border-line bg-surface/80 px-2.5 py-2 hover:-translate-y-px hover:border-line-strong hover:bg-surface"
      style={{ boxShadow: accent ? `inset 3px 0 0 0 ${accent}` : undefined }}
      title={t.title}
    >
      <div
        className="line-clamp-2 text-body leading-snug"
        style={{
          textDecoration: done ? "line-through" : undefined,
          color: done ? "var(--muted)" : overdueTimed ? "var(--signal)" : "var(--ink)",
        }}
      >
        {t.title}
      </div>
      {(t.start_time || t.duration_minutes) && (
        <div className="mt-1.5 flex items-center gap-2">
          {t.start_time && <span className="mono text-micro text-muted">{fmtTime(t.start_time)}</span>}
          {t.duration_minutes ? (
            <span className="mono text-micro text-muted">{fmtDuration(t.duration_minutes)}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TrayChip({
  t,
  now,
  today,
  accent,
}: {
  t: Task;
  now: Date;
  today: string;
  accent: string | null;
}) {
  const overdue = t.do_date != null && t.do_date < today;
  void now;
  return (
    <div
      data-task-drag={t.id}
      className="fast flex shrink-0 cursor-pointer touch-none select-none items-center gap-2 rounded-lg border bg-surface/80 px-2.5 py-1.5 text-body hover:-translate-y-px hover:bg-surface"
      style={{
        borderColor: overdue ? "var(--signal-soft)" : "var(--line)",
        boxShadow: accent ? `inset 3px 0 0 0 ${accent}` : undefined,
      }}
      title={overdue ? "Overdue — drag onto a day" : "Drag onto a day"}
    >
      <span className="max-w-[180px] truncate" style={{ color: overdue ? "var(--signal)" : "var(--ink)" }}>
        {t.title}
      </span>
      {t.duration_minutes ? (
        <span className="mono shrink-0 text-micro text-muted">{fmtDuration(t.duration_minutes)}</span>
      ) : null}
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
