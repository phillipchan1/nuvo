// Plan the week — the weekly ritual, reduced to its one honest job: arrive to a
// week that's already been pulled and time-blocked, then tune and commit. The
// old five gated steps are gone. What you do is a draft, not a form:
//
//   · the pull + the compose run the moment it opens (no "compose" button)
//   · every block still carries its reason — you keep the map, never lost
//   · one gesture overrides anything — drop a block, add a candidate, flag a bet
//   · the only required click is Commit
//
// Defaults are pre-decided, settings live in Settings (working hours tuck away),
// intelligence does the deciding-where. You stay at altitude.

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, subDays } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useSettings } from "../../hooks/useSettings";
import { useWorkingDays } from "../../hooks/useWorkingDays";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useSlots } from "../../hooks/useSlots";
import { useAllTasks, useScheduledTasks } from "../../hooks/useTasks";
import {
  backlogTasks,
  domainById,
  faithfulness,
  inboxTasks,
  initiativeProgress,
  initiativeProgressAt,
  isOpenStatus,
  isProjectInFlight,
  sprintMinsByDomain,
  sprintTasks,
  taskDomainColor,
  type Initiative,
  type VerticalData,
} from "../../lib/vertical";
import { endOf, fmtHours as hrs, formatHourLabel, parseDateISO, planningWeekStartISO, todayISO } from "../../lib/dates";
import { CONTEXT_META, composeWeek, type DayContext, type Placement } from "../../lib/compose";
import { batchWeek, type BatchResult } from "../../lib/batch";
import { calibrate, confidence, weeklyBudgetMins } from "../../lib/calibration";
import { suggestPull } from "../../lib/pull";
import { MomentumChip } from "../floors/parts";
import { BigRocks } from "../floors/bigRocks";
import type { ExternalEvent, Slot, Task } from "../../lib/types";
import { Btn, Modal } from "../ui";

const CONTEXT_CYCLE: DayContext[] = ["normal", "light", "travel", "off"];
const DAY_GLYPH = ["S", "M", "T", "W", "T", "F", "S"]; // Sun…Sat, for working-day chips
const HOUR_PX = 44;
const MIN_BLOCK_PX = 18;
const toMinLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmtMinShort = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "p" : "a", hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
};

type Phase = "intent" | "shape";

export default function SundayRitual({ onClose }: { onClose: () => void }) {
  const { data, planWeek, applySlots } = useVertical();
  const { settings } = useSettings();
  const { data: allTasks = [] } = useAllTasks();

  const [committed, setCommitted] = useState(false);
  const [applying, setApplying] = useState(false);
  const [goal, setGoal] = useState(data.sprintGoal ?? "");
  // two acts — set the intent (act 1), then shape the composed week (act 2)
  const [phase, setPhase] = useState<Phase>("intent");
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [workingDays, setWorkingDays] = useWorkingDays();

  const weekStartISO = planningWeekStartISO();
  const today = todayISO();
  // current week vs the one ahead — drives the day window and the copy
  const planningAhead = weekStartISO > today;
  const fromGate = planningAhead ? weekStartISO : today;

  const range = useMemo(() => {
    const start = parseDateISO(weekStartISO);
    return { start: start.toISOString(), end: addDays(start, 7).toISOString() };
  }, [weekStartISO]);
  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: blocks = [] } = useScheduledTasks(range.start, range.end);
  const { data: weekSlots = [] } = useSlots(range.start, range.end);
  // honor the calendars the user has hidden in settings — a hidden calendar is
  // not "busy", and counting it makes the week look full when it isn't.
  const hiddenCals = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const visibleEvents = useMemo(() => events.filter((e) => !hiddenCals.has(e.calendar_id)), [events, hiddenCals]);

  // ── the two buckets, intelligence picks: projects (lead bets, next-up,
  //    deadlines) + inbox (deadlines, faithfulness top-ups). One ranked set. ──
  const suggestions = useMemo(() => suggestPull(data), [data]);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  // seed the draft once: the pull, PLUS anything already committed-but-unplaced
  // (re-entry recomposes the existing week pool instead of dropping it)
  useEffect(() => {
    if (seeded.current) return;
    const pool = sprintTasks(data).filter((t) => t.status === "ready").map((t) => t.id);
    const ids = [...suggestions.map((s) => s.task.id), ...pool];
    if (ids.length) {
      setKept(new Set(ids));
      seeded.current = true;
    }
  }, [suggestions, data]);

  // raw rows for the kept candidates — the composer needs the deadline ISO that
  // VTask drops; exclude anything already on the calendar (no double-placing)
  const keptTasks = useMemo<Task[]>(
    () => allTasks.filter((t) => kept.has(t.id) && !t.start_time && !t.slot_id && t.status !== "done"),
    [allTasks, kept],
  );

  // boundaries: working hours are a SETTING (not a step); per-day contexts live
  // on the sprint row and persist as you cycle them
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;
  const dayContexts = useMemo(
    () => (data.sprint?.day_contexts ?? {}) as Record<string, DayContext>,
    [data.sprint],
  );

  // calibration: the proven pace bounds the plan
  const cal = useMemo(() => calibrate(data.tasks), [data.tasks]);
  const budget = weeklyBudgetMins(cal);
  const onCalBlocks = useMemo(() => blocks.filter((b) => b.status !== "done"), [blocks]);
  const blockedMins = useMemo(
    () => onCalBlocks.reduce((s, b) => s + (b.duration_minutes ?? 30), 0),
    [onCalBlocks],
  );

  // ── compose-on-open: the schedule recomputes from the draft, live ──────────
  const result = useMemo(
    () =>
      composeWeek({
        weekStartISO,
        todayISO: today,
        now: new Date(),
        tasks: keptTasks,
        events: visibleEvents,
        blocks: onCalBlocks,
        workStartMin: workStart,
        workEndMin: workEnd,
        focusInitiativeIds: data.focusInitiativeIds,
        dayContexts,
        workingDays,
        weeklyBudgetMins: budget != null ? Math.max(0, budget - blockedMins) : null,
      }),
    [weekStartISO, today, keptTasks, visibleEvents, onCalBlocks, workStart, workEnd, data.focusInitiativeIds, dayContexts, workingDays, budget, blockedMins],
  );

  const gain = useMemo(() => computeGain(data), [data]);
  const plannedMins = result.placements.reduce((s, p) => s + p.durationMin, 0) + blockedMins;
  const conf = cal && plannedMins > 0 ? confidence(plannedMins, cal) : null;
  const dropBlock = (taskId: string) =>
    setKept((prev) => new Set([...prev].filter((id) => id !== taskId)));

  // ── batch the committed week into named focus blocks (Slots) ──────────────
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const proposeBatch = () => {
    const pool = allTasks.filter(
      (t) =>
        t.sprint_id && t.sprint_id === data.sprint?.id &&
        t.status !== "done" && t.status !== "trashed" && !t.start_time && !t.slot_id,
    );
    setBatch(
      batchWeek({
        tasks: pool,
        data,
        weekStartISO,
        todayISO: today,
        now: new Date(),
        events: visibleEvents,
        blocks: onCalBlocks,
        workStartMin: workStart,
        workEndMin: workEnd,
        focusInitiativeIds: data.focusInitiativeIds,
        dayContexts,
        workingDays,
      }),
    );
  };
  const applyBatch = async () => {
    if (!batch) return;
    await applySlots(
      batch.placed.map((p) => {
        const [y, mo, d] = p.dayISO.split("-").map(Number);
        return {
          title: p.batch.name,
          doDateISO: p.dayISO,
          startISO: new Date(y, mo - 1, d, Math.floor(p.startMin / 60), p.startMin % 60).toISOString(),
          durationMins: p.durationMin,
          domainId: p.batch.domainId,
          color: p.batch.color,
          taskIds: p.batch.taskIds,
        };
      }),
    );
    setBatch(null);
  };

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(parseDateISO(weekStartISO), i), "yyyy-MM-dd")),
    [weekStartISO],
  );
  // the planner columns: the working days of the week (Mon–Fri by default),
  // past ones dimmed — the familiar week grid, not a fresh shape to parse
  const gridDays = useMemo(
    () =>
      weekDays
        .filter((iso) => workingDays.includes(parseDateISO(iso).getDay()))
        .map((iso) => ({ iso, past: iso < fromGate })),
    [weekDays, workingDays, fromGate],
  );

  const keptCount = keptTasks.length;
  const placedCount = result.placements.length;

  // esc closes; the draft resumes — nothing is committed until you say so
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = async () => {
    setApplying(true);
    await planWeek({
      commitTaskIds: [...kept],
      placements: result.placements.map((p) => {
        const [y, mo, d] = p.dayISO.split("-").map(Number);
        return {
          id: p.task.id,
          doDateISO: p.dayISO,
          startISO: new Date(y, mo - 1, d, Math.floor(p.startMin / 60), p.startMin % 60).toISOString(),
        };
      }),
      goal: goal.trim(),
    });
    setApplying(false);
    setCommitted(true);
  };

  if (committed) {
    return (
      <Shell onClose={onClose} weekLabel={format(parseDateISO(weekStartISO), "MMM d")} planningAhead={planningAhead}>
        <DoneState onClose={onClose} />
      </Shell>
    );
  }

  const eventCount = visibleEvents.filter((e) => e.busy && !e.all_day).length;

  return (
    <Shell
      onClose={onClose}
      weekLabel={format(parseDateISO(weekStartISO), "MMM d")}
      planningAhead={planningAhead}
      steps={<StepNav phase={phase} setPhase={setPhase} />}
      footer={
        phase === "intent" ? (
          <IntentBar
            priorityCount={data.bigRocks.filter((r) => r.title.trim()).length}
            leadCount={data.focusInitiativeIds.length}
            onNext={() => setPhase("shape")}
          />
        ) : (
          <CommitBar
            goal={goal}
            setGoal={setGoal}
            lastGoal={data.sprintGoal ?? ""}
            conf={conf}
            cal={cal}
            plannedMins={plannedMins}
            keptCount={keptCount}
            applying={applying}
            onCommit={() => void commit()}
          />
        )
      }
    >
      {phase === "intent" ? (
        <div className="mx-auto max-w-[1080px] space-y-5">
          {/* ── ACT 1 · set the week — the read, then the intent ── */}
          {/* the gain — a read, not a gate: a glance back before the week ahead */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-caption">
            <span className="text-muted">Last 7 days</span>
            <span className="font-medium">{gain.doneCount} done · {hrs(gain.doneMins)}h</span>
            {gain.topMove && (
              <span className="mono text-label" style={{ color: "var(--accent)" }}>
                {gain.topMove.name} {gain.topMove.from}%→{gain.topMove.to}%
              </span>
            )}
            {gain.quiet.length > 0 && (
              <span className="mono text-label text-signal">{gain.quiet.join(", ")} quiet</span>
            )}
          </div>

          {/* the bets — the one strategic call; carried forward, stalled flagged */}
          <BetsStrip />

          {/* priorities — name what would make this week a win, before the blocks */}
          <BigRocks />
        </div>
      ) : (
        // ── ACT 2 · shape it — the composed week wide, pull + boundaries railed ──
        <div className="flex flex-col gap-6 lg:flex-row">
          <section className="min-w-0 flex-1">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-head font-semibold tracking-tight">The week</h2>
                <button onClick={proposeBatch} className="fast mono text-meta text-accent hover:underline" title="Group the week's committed work into a few intelligent focus blocks">
                  ✦ batch into focus blocks
                </button>
              </div>
              <span className="mono shrink-0 text-meta text-muted">
                {placedCount} placed · {result.unplaced.length} in the pool
                {eventCount > 0 && ` · ${eventCount} immovable`}
              </span>
            </div>

            {gridDays.length === 0 ? (
              <div className="rounded-md border border-dashed border-line p-10 text-center text-caption text-muted">
                No working days set — open Boundaries to choose which days you work.
              </div>
            ) : (
              <>
                <WeekGrid
                  days={gridDays}
                  events={visibleEvents}
                  slots={weekSlots}
                  locked={onCalBlocks}
                  placements={result.placements}
                  data={data}
                  workStartMin={workStart}
                  workEndMin={workEnd}
                  dayContexts={dayContexts}
                  onDrop={dropBlock}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-meta text-muted">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--accent)", outline: "1.5px solid rgba(255,255,255,.6)", outlineOffset: -1.5 }} /> placed for you</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--accent)", opacity: .82 }} /> already set ✓</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-line bg-bg" /> immovable</span>
                  <span className="mono ml-auto">hover a placed block to drop it</span>
                </div>
              </>
            )}

            {result.unplaced.length > 0 && (
              <div className="mt-3 rounded-md border border-dashed border-line px-4 py-2.5">
                <div className="section-label mb-1">In the pool — committed, no time yet ({result.unplaced.length})</div>
                {result.unplaced.map(({ task, reason }) => (
                  <div key={task.id} className="flex items-center gap-2 text-label text-muted">
                    <span className="min-w-0 truncate">{task.title}</span>
                    <span className="mono shrink-0 text-micro">{reason}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* right rail — the pull + boundaries beside the week, not stacked below */}
          <aside className="shrink-0 space-y-5 lg:w-[360px]">
            {/* the candidates — the merged pull; toggle what belongs to the week */}
            <Candidates suggestions={suggestions} kept={kept} setKept={setKept} data={data} />

            {/* boundaries — settings, tucked away; here when you need them */}
            <Boundaries
              open={showBoundaries}
              onToggle={() => setShowBoundaries((s) => !s)}
              weekDays={weekDays}
              fromGate={fromGate}
              workingDays={workingDays}
              setWorkingDays={setWorkingDays}
            />
          </aside>
        </div>
      )}
      {batch && (
        <SlotBatchModal batch={batch} data={data} onApply={() => void applyBatch()} onClose={() => setBatch(null)} />
      )}
    </Shell>
  );
}

// ── the overlay chrome ───────────────────────────────────────────────────────
function Shell({
  onClose,
  weekLabel,
  planningAhead,
  steps,
  footer,
  children,
}: {
  onClose: () => void;
  weekLabel: string;
  planningAhead: boolean;
  steps?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scrim atmosphere fixed inset-0 z-50 flex flex-col">
      {/* clears the macOS traffic lights + gives a drag handle */}
      <div data-tauri-drag-region className="h-8 w-full shrink-0 bg-surface" />
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-5 py-2.5 elev-1">
        <div className="flex items-baseline gap-3">
          <div className="wordmark text-head">Plan</div>
          <div className="mono text-label text-muted">
            week of {weekLabel}
            <span className="ml-1.5 rounded-full border border-line px-1.5 py-0.5 text-micro">
              {planningAhead ? "the week ahead" : "this week"}
            </span>
          </div>
        </div>
        {steps && <div className="hidden md:block">{steps}</div>}
        <div className="flex-1" />
        <button onClick={onClose} className="keycap shrink-0">esc — resumes later</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{children}</div>
      {footer}
    </div>
  );
}

// the two acts — set the intent, then shape the week. NOT a gated wizard: the
// week is still pre-composed; this just splits a long page into two calm beats,
// and the dots jump freely between them.
function StepNav({ phase, setPhase }: { phase: Phase; setPhase: (p: Phase) => void }) {
  const steps: { id: Phase; n: number; label: string }[] = [
    { id: "intent", n: 1, label: "Set the week" },
    { id: "shape", n: 2, label: "Shape it" },
  ];
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => {
        const active = s.id === phase;
        const done = phase === "shape" && s.id === "intent";
        return (
          <div key={s.id} className="flex items-center gap-1">
            {i > 0 && <span className="mono text-meta text-line">→</span>}
            <button
              onClick={() => setPhase(s.id)}
              className="fast mono flex items-center gap-1.5 rounded-full px-2 py-0.5 text-label"
              style={{ background: active ? "var(--accent-soft)" : "transparent", color: active ? "var(--accent)" : "var(--muted)" }}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full text-micro"
                style={{
                  background: active ? "var(--accent)" : done ? "var(--accent-soft)" : "var(--line)",
                  color: active ? "#fff" : done ? "var(--accent)" : "var(--muted)",
                }}
              >
                {done ? "✓" : s.n}
              </span>
              {s.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Act 1's footer — the forward beat into shaping the week.
function IntentBar({ priorityCount, leadCount, onNext }: { priorityCount: number; leadCount: number; onNext: () => void }) {
  return (
    <footer className="shrink-0 border-t border-line bg-surface px-8 py-3 elev-1">
      <div className="mx-auto flex max-w-[1080px] items-center gap-4">
        <div className="mono min-w-0 flex-1 text-meta text-muted">
          {priorityCount > 0 ? `${priorityCount} priorit${priorityCount === 1 ? "y" : "ies"}` : "no priorities yet"}
          {leadCount > 0 ? ` · ★ ${leadCount} lead${leadCount === 1 ? "" : "s"}` : ""}
          {" — set the intent, then shape the week around it"}
        </div>
        <Btn kind="primary" onClick={onNext} className="shrink-0 px-4 py-2">Shape the week →</Btn>
      </div>
    </footer>
  );
}

// ── the bets — ≤3 leads, carried forward; verdicts on the stalled ────────────
function BetsStrip() {
  const { data, setFocusInitiatives, updateInitiative } = useVertical();
  const leads = data.focusInitiativeIds;
  const cutoff = useMemo(() => subDays(new Date(), 7), []);
  const rows = data.initiatives.filter((i) => isOpenStatus(i.status));
  const leadInits = rows.filter((i) => leads.includes(i.id));
  const stalledLeads = leadInits.filter(
    (i) => i.status !== "waiting" && initiativeProgress(data, i) === initiativeProgressAt(data, i, cutoff) && i.momentum !== "up",
  );
  const [manage, setManage] = useState(false);
  const open = manage || stalledLeads.length > 0;

  const toggleLead = (id: string) => {
    if (leads.includes(id)) setFocusInitiatives(leads.filter((x) => x !== id));
    else if (leads.length < 3) setFocusInitiatives([...leads, id]);
  };

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-head font-semibold tracking-tight">
          The bets <span className="mono text-meta font-normal text-muted">★ {leads.length}/3 leads</span>
        </h2>
        {rows.length > 0 && (
          <button onClick={() => setManage((m) => !m)} className="fast mono text-meta text-muted hover:text-ink">
            {open ? "done" : "adjust"}
          </button>
        )}
      </div>

      {!open ? (
        <div className="flex flex-wrap gap-1.5">
          {leadInits.length === 0 && (
            <span className="text-caption text-muted italic">No lead bets — the week runs on faithfulness and deadlines. Tap adjust to pick up to three.</span>
          )}
          {leadInits.map((i) => {
            const domain = domainById(data, i.domainId);
            return (
              <span
                key={i.id}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label"
                style={{ borderColor: "var(--signal)", background: "var(--signal-soft)" }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: domain?.color }} />
                {i.name}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((i) => (
            <BetRow
              key={i.id}
              initiative={i}
              data={data}
              cutoff={cutoff}
              lead={leads.includes(i.id)}
              leadFull={leads.length >= 3}
              onToggleLead={() => toggleLead(i.id)}
              onUpdate={(patch) => updateInitiative(i.id, patch)}
            />
          ))}
          {rows.length === 0 && (
            <div className="rounded-md border border-dashed border-line p-6 text-center text-caption text-muted">
              No active initiatives. Start a bet on the Initiative floor (⌘4).
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BetRow({
  initiative,
  data,
  cutoff,
  lead,
  leadFull,
  onToggleLead,
  onUpdate,
}: {
  initiative: Initiative;
  data: VerticalData;
  cutoff: Date;
  lead: boolean;
  leadFull: boolean;
  onToggleLead: () => void;
  onUpdate: (patch: Partial<Initiative>) => void;
}) {
  const domain = domainById(data, initiative.domainId);
  const paused = initiative.status === "waiting";
  const from = initiativeProgressAt(data, initiative, cutoff);
  const to = initiativeProgress(data, initiative);
  const stalled = !paused && to === from && initiative.momentum !== "up";
  const daysLeft = initiative.targetDate
    ? differenceInCalendarDays(parseDateISO(initiative.targetDate), new Date())
    : null;

  return (
    <div
      className="flex items-center gap-3 rounded-md border bg-surface px-3.5 py-2.5"
      style={{ borderColor: lead ? "var(--signal)" : "var(--line)", opacity: paused ? 0.55 : 1 }}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: domain?.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium">{initiative.name}</div>
        <div className="mono truncate text-micro text-muted">
          {domain?.name}
          {initiative.outcome && ` · ${initiative.outcome}`}
        </div>
      </div>

      {stalled && (
        <span className="mono shrink-0 rounded-full border border-signal px-2 py-0.5 text-micro text-signal">
          stalled — commit, pause, or drop
        </span>
      )}

      <span className="mono shrink-0 text-label" style={{ color: to > from ? "var(--accent)" : "var(--muted)" }}>
        {to > from ? `${from}%→${to}%` : `${to}%`}
      </span>

      {daysLeft != null && (
        <span className="mono shrink-0 text-meta" style={{ color: daysLeft < 14 ? "var(--signal)" : "var(--muted)" }}>
          {daysLeft >= 0 ? `${daysLeft}d left` : `${-daysLeft}d over`}
        </span>
      )}

      <MomentumChip value={initiative.momentum} onChange={(m) => onUpdate({ momentum: m })} />

      {paused ? (
        <Btn onClick={() => onUpdate({ status: "in_progress" })}>resume</Btn>
      ) : (
        <>
          <button
            onClick={onToggleLead}
            disabled={!lead && leadFull}
            title={lead ? "Remove lead" : leadFull ? "Three leads already" : "Make this a lead bet"}
            className="fast mono shrink-0 rounded-sm border px-2 py-1 text-meta disabled:opacity-30"
            style={{
              borderColor: lead ? "var(--signal)" : "var(--line)",
              color: lead ? "var(--signal)" : "var(--muted)",
              background: lead ? "var(--signal-soft)" : "transparent",
            }}
          >
            ★ lead
          </button>
          <Btn onClick={() => onUpdate({ status: "waiting" })}>pause</Btn>
          <Btn kind="signal" onClick={() => onUpdate({ status: "cancelled" })}>drop</Btn>
        </>
      )}
    </div>
  );
}

// ── the candidates — the merged pull, plus everything else on tap ────────────
function Candidates({
  suggestions,
  kept,
  setKept,
  data,
}: {
  suggestions: ReturnType<typeof suggestPull>;
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  data: VerticalData;
}) {
  const [showMore, setShowMore] = useState(false);
  const toggle = (id: string) => {
    const next = new Set(kept);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKept(next);
  };

  const suggestedIds = new Set(suggestions.map((s) => s.task.id));
  // everything else you could pull in, by hand — inbox first (loose captures),
  // then processed backlog; skip what's already suggested
  const more = useMemo(() => {
    const extra = [...inboxTasks(data), ...backlogTasks(data)].filter((t) => !suggestedIds.has(t.id));
    const seen = new Set<string>();
    return extra.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const keptCount = [...kept].filter((id) => suggestedIds.has(id)).length;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-head font-semibold tracking-tight">
          Pulled for you <span className="mono text-meta font-normal text-muted">{keptCount}/{suggestions.length} in the week</span>
        </h2>
        <button onClick={() => setShowMore((s) => !s)} className="fast mono text-meta text-muted hover:text-ink">
          {showMore ? "hide" : "＋ add more"}
        </button>
      </div>

      <div className="space-y-1">
        {suggestions.length === 0 && (
          <div className="rounded-md border border-dashed border-line p-6 text-center text-caption text-muted">
            Nothing to pull — inbox is clear and no deadlines land this week.
          </div>
        )}
        {suggestions.map((s) => {
          const on = kept.has(s.task.id);
          const carried = s.task.rollCount > 0;
          return (
            <CandidateRow
              key={s.task.id}
              on={on}
              onToggle={() => toggle(s.task.id)}
              color={domainById(data, s.task.domainId)?.color}
              title={s.task.title}
              mins={s.task.durationMins}
              reason={s.reason}
              carried={carried}
            />
          );
        })}
      </div>

      {showMore && (
        <div className="mt-2 max-h-[34vh] overflow-y-auto rounded-md border border-line bg-surface p-2">
          <div className="section-label mb-1">Inbox &amp; backlog ({more.length})</div>
          {more.length === 0 && <div className="px-2 py-3 text-center text-label text-muted">Nothing else waiting.</div>}
          {more.map((t) => (
            <CandidateRow
              key={t.id}
              on={kept.has(t.id)}
              onToggle={() => toggle(t.id)}
              color={domainById(data, t.domainId)?.color}
              title={t.title || "untitled"}
              mins={t.durationMins}
              reason={t.inbox ? "from the inbox" : "from a backlog"}
              carried={t.rollCount > 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CandidateRow({
  on,
  onToggle,
  color,
  title,
  mins,
  reason,
  carried,
}: {
  on: boolean;
  onToggle: () => void;
  color?: string | null;
  title: string;
  mins: number;
  reason: string;
  carried: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className="fast flex w-full items-center gap-2.5 rounded-sm border px-2.5 py-1.5 text-left"
      style={{
        borderColor: on ? "var(--accent)" : "var(--line)",
        background: on ? "var(--accent-soft)" : "transparent",
      }}
    >
      <span
        className="mono flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-micro"
        style={{ borderColor: on ? "var(--accent)" : "var(--line)", color: "var(--accent)" }}
      >
        {on ? "✓" : ""}
      </span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color ?? "var(--line)" }} />
      <span className="min-w-0 flex-1 truncate text-caption" style={{ opacity: on ? 1 : 0.6 }}>
        {title}
      </span>
      {carried && <span className="mono shrink-0 text-micro text-signal" title="Carried over from a past week">↻ carried</span>}
      <span className="mono shrink-0 text-micro text-muted">{reason}</span>
      <span className="mono shrink-0 text-meta text-muted">{hrs(mins)}h</span>
    </button>
  );
}

// ── boundaries — working hours (a setting) + per-day contexts; tucked away ───
function Boundaries({
  open,
  onToggle,
  weekDays,
  fromGate,
  workingDays,
  setWorkingDays,
}: {
  open: boolean;
  onToggle: () => void;
  weekDays: string[];
  fromGate: string;
  workingDays: number[];
  setWorkingDays: (d: number[]) => void;
}) {
  const { data, setDayContexts } = useVertical();
  const { settings, update: updateSettings } = useSettings();
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;
  const dayContexts = (data.sprint?.day_contexts ?? {}) as Record<string, DayContext>;
  // context tweaks only make sense on the days you actually work
  const workingISOs = weekDays.filter((iso) => workingDays.includes(parseDateISO(iso).getDay()));

  const setWork = (key: "work_start_minutes" | "work_end_minutes") => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const [h, mm] = e.target.value.split(":").map(Number);
    updateSettings({ [key]: h * 60 + mm });
  };
  const cycleContext = (iso: string) => {
    const cur = dayContexts[iso] ?? "normal";
    const next = CONTEXT_CYCLE[(CONTEXT_CYCLE.indexOf(cur) + 1) % CONTEXT_CYCLE.length];
    setDayContexts({ ...dayContexts, [iso]: next });
  };
  const toggleWorkingDay = (dow: number) =>
    setWorkingDays(workingDays.includes(dow) ? workingDays.filter((d) => d !== dow) : [...workingDays, dow].sort());

  const workingLabel = [1, 2, 3, 4, 5].every((d) => workingDays.includes(d)) && workingDays.length === 5
    ? "Mon–Fri"
    : `${workingDays.length} day${workingDays.length === 1 ? "" : "s"}`;

  return (
    <section className="rounded-md border border-line bg-surface">
      <button onClick={onToggle} className="fast flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="section-label">Boundaries</span>
        <span className="mono text-meta text-muted">
          {workingLabel} · {toMinLabel(workStart)}–{toMinLabel(workEnd)} · click to {open ? "hide" : "adjust"}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          {/* working days — the recurring boundary; weekends off by default */}
          <div className="flex items-center gap-1.5">
            <span className="mono w-[78px] shrink-0 text-meta text-muted">working days</span>
            {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
              const on = workingDays.includes(dow);
              return (
                <button
                  key={dow}
                  onClick={() => toggleWorkingDay(dow)}
                  title={`${on ? "A working day" : "Off"} — click to toggle`}
                  className="fast mono h-6 w-7 rounded-sm border text-meta"
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--line)",
                    color: on ? "var(--accent)" : "var(--muted)",
                    background: on ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  {DAY_GLYPH[dow]}
                </button>
              );
            })}
            <span className="mono ml-1 text-micro text-muted">— a setting, applies every week</span>
          </div>

          <label className="mono flex items-center gap-1.5 text-label text-muted">
            <span className="w-[78px] shrink-0">working hours</span>
            <input type="time" step={900} value={toMinLabel(workStart)} onChange={setWork("work_start_minutes")}
              className="border border-line bg-bg px-1.5 py-0.5 text-label outline-none focus:border-accent" />
            –
            <input type="time" step={900} value={toMinLabel(workEnd)} onChange={setWork("work_end_minutes")}
              className="border border-line bg-bg px-1.5 py-0.5 text-label outline-none focus:border-accent" />
          </label>

          {workingISOs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="mono w-[78px] shrink-0 text-meta text-muted">this week</span>
              {workingISOs.map((iso) => {
                const ctx = dayContexts[iso] ?? "normal";
                const past = iso < fromGate;
                const meta = CONTEXT_META[ctx];
                return (
                  <button
                    key={iso}
                    disabled={past}
                    onClick={() => cycleContext(iso)}
                    title={`${format(parseDateISO(iso), "EEEE")} — ${meta.label} (click to change)`}
                    className="fast mono flex-1 rounded-sm border px-1 py-1 text-meta disabled:opacity-25"
                    style={{
                      borderColor: ctx === "normal" ? "var(--line)" : "var(--accent)",
                      color: ctx === "normal" ? "var(--muted)" : "var(--accent)",
                      background: ctx === "normal" ? "transparent" : "var(--accent-soft)",
                    }}
                  >
                    {format(parseDateISO(iso), "EEEEE")} {meta.glyph}
                  </button>
                );
              })}
              <span className="mono hidden text-micro text-muted xl:inline">· normal ◐ light ✈ travel — off</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── the commit bar — confidence read + the one required click ────────────────
function CommitBar({
  goal,
  setGoal,
  lastGoal,
  conf,
  cal,
  plannedMins,
  keptCount,
  applying,
  onCommit,
}: {
  goal: string;
  setGoal: (g: string) => void;
  lastGoal: string;
  conf: ReturnType<typeof confidence>;
  cal: ReturnType<typeof calibrate>;
  plannedMins: number;
  keptCount: number;
  applying: boolean;
  onCommit: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-line bg-surface px-8 py-3 elev-1">
      <div className="mx-auto flex max-w-[1080px] items-center gap-4">
        <div className="min-w-0 flex-1">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={lastGoal ? `Last week: "${lastGoal}" — name this one` : "One line — what does a good week look like?"}
            className="w-full bg-transparent text-head font-medium outline-none placeholder:text-muted/60"
          />
          <div className="mono mt-0.5 text-meta text-muted">
            {conf && cal ? (
              <span style={{ color: conf.label === "stretch" ? "var(--signal)" : "var(--accent)" }}>
                {conf.pct}% · {conf.label} — {hrs(plannedMins)}h planned vs your ~{hrs(cal.avgWeeklyDoneMins)}h/wk pace
                {conf.deltaMins > 30 && ` · trim ~${hrs(conf.deltaMins)}h`}
              </span>
            ) : (
              <span>{keptCount} committed · a confidence read arrives after a week or two of history</span>
            )}
          </div>
        </div>
        <Btn kind="primary" onClick={onCommit} disabled={applying} className="shrink-0 px-4 py-2">
          {applying ? "committing…" : "Commit the week →"}
        </Btn>
      </div>
    </footer>
  );
}

// ── the week grid — a familiar week planner; OUR placements rendered strong ──
interface GridItem {
  id: string;
  kind: "event" | "locked" | "new" | "slot";
  startMin: number;
  endMin: number;
  title: string;
  color: string | null;
  reason?: string;
}

function WeekGrid({
  days,
  events,
  slots,
  locked,
  placements,
  data,
  workStartMin,
  workEndMin,
  dayContexts,
  onDrop,
}: {
  days: { iso: string; past: boolean }[];
  events: ExternalEvent[];
  slots: Slot[];
  locked: Task[];
  placements: Placement[];
  data: VerticalData;
  workStartMin: number;
  workEndMin: number;
  dayContexts: Record<string, DayContext>;
  onDrop: (taskId: string) => void;
}) {
  const dayKeys = new Set(days.map((d) => d.iso));
  const byDay = new Map<string, GridItem[]>();
  const add = (iso: string, it: GridItem) => {
    if (!dayKeys.has(iso)) return;
    if (!byDay.has(iso)) byDay.set(iso, []);
    byDay.get(iso)!.push(it);
  };

  for (const e of events) {
    if (!e.busy || e.all_day) continue;
    const s = new Date(e.start_at);
    const en = new Date(e.end_at);
    const iso = format(s, "yyyy-MM-dd");
    const sameDay = format(en, "yyyy-MM-dd") === iso;
    add(iso, {
      id: e.id,
      kind: "event",
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: sameDay ? en.getHours() * 60 + en.getMinutes() : 24 * 60,
      title: e.title || "busy",
      color: null,
    });
  }
  for (const b of locked) {
    if (!b.start_time) continue;
    const s = new Date(b.start_time);
    const en = endOf({ start_time: b.start_time, duration_minutes: b.duration_minutes });
    add(format(s, "yyyy-MM-dd"), {
      id: b.id,
      kind: "locked",
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: en.getHours() * 60 + en.getMinutes(),
      title: b.title,
      color: taskDomainColor(data, b),
    });
  }
  for (const p of placements) {
    add(p.dayISO, {
      id: p.task.id,
      kind: "new",
      startMin: p.startMin,
      endMin: p.startMin + p.durationMin,
      title: p.task.title,
      color: taskDomainColor(data, p.task),
      reason: p.reason,
    });
  }
  // batched focus blocks (Slots) the user has already created — shown as
  // intentional blocks holding their tasks
  for (const sl of slots) {
    const s = new Date(sl.start_time);
    const en = new Date(s.getTime() + sl.duration_minutes * 60_000);
    add(format(s, "yyyy-MM-dd"), {
      id: sl.id,
      kind: "slot",
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: en.getHours() * 60 + en.getMinutes(),
      title: sl.title,
      color: sl.color ?? (sl.domain_id ? domainById(data, sl.domain_id)?.color ?? null : null),
    });
  }

  // the visible window: work hours, stretched to fit anything poking outside
  let lo = workStartMin;
  let hi = workEndMin;
  for (const items of byDay.values()) for (const it of items) {
    lo = Math.min(lo, it.startMin);
    hi = Math.max(hi, it.endMin);
  }
  lo = Math.max(0, Math.floor(lo / 60) * 60);
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  const hours: number[] = [];
  for (let h = lo; h < hi; h += 60) hours.push(h);
  const totalH = ((hi - lo) / 60) * HOUR_PX;
  const yOf = (m: number) => ((m - lo) / 60) * HOUR_PX;

  return (
    <div className="overflow-auto rounded-md border border-line bg-surface" style={{ maxHeight: "62vh" }}>
      {/* day headers — sticky so they stay put while the grid scrolls */}
      <div className="sticky top-0 z-10 flex border-b border-line bg-surface">
        <div className="w-[52px] shrink-0" />
        {days.map((d) => {
          const ctx = dayContexts[d.iso] ?? "normal";
          return (
            <div key={d.iso} className="min-w-[150px] flex-1 border-l border-line px-2 py-1.5 text-center" style={{ opacity: d.past ? 0.4 : 1 }}>
              <div className="text-caption font-semibold">{format(parseDateISO(d.iso), "EEE")}</div>
              <div className="mono text-micro text-muted">
                {format(parseDateISO(d.iso), "MMM d")}
                {ctx !== "normal" && <span className="ml-1 text-accent">{CONTEXT_META[ctx].label}</span>}
                {d.past && " · passed"}
              </div>
            </div>
          );
        })}
      </div>

      {/* the time canvas */}
      <div className="flex" style={{ height: totalH }}>
        <div className="w-[52px] shrink-0">
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_PX }}>
              <span className="mono absolute -top-1.5 right-1.5 text-micro text-muted">{formatHourLabel(Math.floor(h / 60))}</span>
            </div>
          ))}
        </div>
        {days.map((d) => {
          const items = (byDay.get(d.iso) ?? []).sort((a, b) => a.startMin - b.startMin);
          return (
            <div key={d.iso} className="relative min-w-[150px] flex-1 border-l border-line" style={{ opacity: d.past ? 0.5 : 1 }}>
              {hours.map((h, i) =>
                i === 0 ? null : <div key={h} className="absolute inset-x-0" style={{ top: yOf(h), borderTop: "1px solid var(--line)", opacity: 0.5 }} />,
              )}
              {items.map((it) => {
                const top = yOf(it.startMin);
                const height = Math.max(MIN_BLOCK_PX, yOf(it.endMin) - yOf(it.startMin));
                if (it.kind === "event") {
                  return (
                    <div
                      key={`ev-${it.id}`}
                      className="absolute inset-x-1 overflow-hidden rounded-[4px] border border-line bg-bg/80 px-1.5 py-0.5"
                      style={{ top, height }}
                      title={it.title}
                    >
                      <div className="mono truncate text-micro leading-tight text-muted">{it.title}</div>
                    </div>
                  );
                }
                const isNew = it.kind === "new";
                const isSlot = it.kind === "slot";
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    className="group absolute inset-x-1 overflow-hidden rounded-[5px] px-1.5 py-1 text-white"
                    style={{
                      top,
                      height,
                      background: it.color ?? "var(--accent)",
                      opacity: isNew ? 1 : isSlot ? 0.96 : 0.8,
                      outline: isNew || isSlot ? "1.5px solid rgba(255,255,255,0.55)" : "none",
                      outlineOffset: -1.5,
                      boxShadow: isNew || isSlot ? "0 3px 10px -4px rgba(0,0,0,0.45)" : "none",
                    }}
                    title={isNew ? it.reason : isSlot ? "focus block — your batched work" : "already on the calendar — locked"}
                  >
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1 truncate text-meta font-semibold leading-tight">{isSlot ? `⛶ ${it.title}` : it.title}</div>
                      {isNew ? (
                        <button
                          onClick={() => onDrop(it.id)}
                          className="fast shrink-0 text-caption leading-none text-white/70 opacity-0 hover:text-white group-hover:opacity-100"
                          title="Remove from the week"
                        >
                          ×
                        </button>
                      ) : isSlot ? null : (
                        <span className="shrink-0 text-micro leading-none opacity-80">✓</span>
                      )}
                    </div>
                    {height > 30 && (
                      <div className="mono truncate text-micro leading-tight text-white/80">
                        {fmtMinShort(it.startMin)}–{fmtMinShort(it.endMin)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── the close ────────────────────────────────────────────────────────────────
function DoneState({ onClose }: { onClose: () => void }) {
  const { data } = useVertical();
  const committed = sprintTasks(data).filter((t) => t.status !== "done");
  const totalMins = committed.reduce((s, t) => s + t.durationMins, 0);
  const split = sprintMinsByDomain(data);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-[460px] text-center">
        <div className="text-display font-semibold tracking-tight">Your week is set.</div>
        {data.sprintGoal && <div className="mt-2 text-head text-muted">“{data.sprintGoal}”</div>}
        <div className="mono mt-3 text-label text-muted">
          {hrs(totalMins)}h committed · {committed.length} tasks · {split.length} domain{split.length === 1 ? "" : "s"} · ★ {data.focusInitiativeIds.length} lead bet{data.focusInitiativeIds.length === 1 ? "" : "s"}
        </div>
        {split.length > 0 && (
          <div className="mx-auto mt-4 flex h-2 max-w-[300px] overflow-hidden rounded-full bg-surface">
            {split.map((x) => (
              <div
                key={x.domain.id}
                title={`${x.domain.name} · ${hrs(x.mins)}h`}
                style={{ width: `${(x.mins / Math.max(1, split.reduce((s, y) => s + y.mins, 0))) * 100}%`, background: x.domain.color }}
              />
            ))}
          </div>
        )}
        <div className="mt-6">
          <Btn kind="primary" onClick={onClose}>Begin the week</Btn>
        </div>
      </div>
    </div>
  );
}

// ── the gain, compressed to a glance ─────────────────────────────────────────
function computeGain(data: VerticalData) {
  const cutoff = subDays(new Date(), 7);
  const done = data.tasks.filter((t) => t.status === "done" && t.completedAt && new Date(t.completedAt) >= cutoff);
  const doneMins = done.reduce((s, t) => s + t.durationMins, 0);

  const moved = data.initiatives
    .filter((i) => isProjectInFlight(i.status))
    .map((i) => ({ name: i.name, from: initiativeProgressAt(data, i, cutoff), to: initiativeProgress(data, i) }))
    .filter((x) => x.to > x.from)
    .sort((a, b) => b.to - b.from - (a.to - a.from));

  const quiet = data.domains
    .filter((d) => d.weeklyTargetHours > 0 && !faithfulness(d).lit)
    .map((d) => d.name)
    .slice(0, 2);

  return { doneCount: done.length, doneMins, topMove: moved[0] ?? null, quiet };
}

// ── the batched week — proposed focus blocks, reviewed before they're created ─
function SlotBatchModal({
  batch,
  data,
  onApply,
  onClose,
}: {
  batch: BatchResult;
  data: VerticalData;
  onApply: () => void;
  onClose: () => void;
}) {
  const titleOf = (id: string) => data.tasks.find((t) => t.id === id)?.title ?? "task";
  const days = [...new Set(batch.placed.map((p) => p.dayISO))].sort();
  return (
    <Modal onClose={onClose} width="max-w-lg">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-head font-semibold">Focus blocks</div>
        <div className="mono text-caption text-muted">
          {batch.placed.length} block{batch.placed.length === 1 ? "" : "s"}
          {batch.unplaced.length ? ` · ${batch.unplaced.length} unplaced` : ""}
        </div>
      </div>

      {batch.placed.length === 0 ? (
        <div className="p-5 text-center text-body text-muted">
          Nothing to batch — the week's committed work is empty or already blocked.
        </div>
      ) : (
        <div className="max-h-[55vh] space-y-3 overflow-y-auto p-3">
          {days.map((day) => (
            <div key={day}>
              <div className="section-label mb-1">{format(parseDateISO(day), "EEE MMM d")}</div>
              <div className="space-y-1.5">
                {batch.placed
                  .filter((p) => p.dayISO === day)
                  .sort((a, b) => a.startMin - b.startMin)
                  .map((p) => (
                    <div
                      key={p.batch.id}
                      className="rounded-md border border-line bg-surface px-3 py-2"
                      style={{ borderLeft: `3px solid ${p.batch.color ?? "var(--accent)"}` }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-body font-medium">{p.batch.name}</span>
                        <span className="mono shrink-0 text-meta text-muted">{fmtBlock(p.startMin)}–{fmtBlock(p.startMin + p.durationMin)}</span>
                      </div>
                      <div className="mono mt-0.5 truncate text-micro text-muted">{p.batch.taskIds.map(titleOf).join(" · ")}</div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {batch.unplaced.length > 0 && (
        <div className="border-t border-line px-4 py-2 text-label text-muted">
          {batch.unplaced.length} block{batch.unplaced.length === 1 ? "" : "s"} didn't fit — their tasks stay in the pool.
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line p-3">
        {batch.placed.length > 0 && (
          <Btn kind="primary" onClick={onApply}>Create {batch.placed.length} focus block{batch.placed.length === 1 ? "" : "s"} →</Btn>
        )}
        <Btn onClick={onClose}>{batch.placed.length > 0 ? "Cancel" : "Close"}</Btn>
      </div>
    </Modal>
  );
}

function fmtBlock(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "p" : "a", hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ap}` : `${hh}:${String(mm).padStart(2, "0")}${ap}`;
}
