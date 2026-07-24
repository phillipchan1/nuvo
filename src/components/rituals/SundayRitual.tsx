// Plan the week — the weekly ritual, reduced to its one honest job: arrive to a
// week that's already been pulled and time-blocked, then tune and commit. The
// old five gated steps are gone. What you do is a draft, not a form:
//
//   · the pull + the compose run the moment it opens (no "compose" button)
//   · every block still carries its reason — you keep the map, never lost
//   · one gesture overrides anything — drop a block, add a candidate, flag an initiative
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
import { useSlots, useSlotTasks } from "../../hooks/useSlots";
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
  projectById,
  sprintMinsByDomain,
  sprintTasks,
  taskDomainColor,
  type Initiative,
  type VerticalData,
} from "../../lib/vertical";
import { endOf, fmtHours as hrs, formatHourLabel, parseDateISO, planningWeekStartISO, todayISO } from "../../lib/dates";
import { sprintLabel } from "../../lib/sprint";
import { CONTEXT_META, composeWeek, plannedMinutes, type DayContext, type Placement } from "../../lib/compose";
import { isEventHidden } from "../../lib/now";
import { clusterInboxRuns, clusterWeek, synthTask, type Batch, type InboxGroup } from "../../lib/batch";
import { isStandingSlot, routeToStanding } from "../../lib/standingSlots";
import { supabase } from "../../lib/supabase";
import { calibrate, confidence, weeklyBudgetMins } from "../../lib/calibration";
import { suggestPull, type PullSuggestion } from "../../lib/pull";
import { MomentumChip } from "../floors/parts";
import { BigRocks } from "../floors/bigRocks";
import type { ExternalEvent, Slot, Task } from "../../lib/types";
import { Btn } from "../ui";

/** One board block's identity. A split overdue task yields several blocks that
 *  share a task id, so the BLOCK — not the task — is what you move and resize. */
const placementKey = (p: Placement) => (p.parts && p.parts > 1 ? `${p.task.id}#${p.part}` : p.task.id);

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
  const { data, planWeek, applySlots, assignToStanding } = useVertical();
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
  const hiddenEventKeys = useMemo(() => new Set((settings?.hidden_events ?? []).map((h) => h.key)), [settings]);
  const visibleEvents = useMemo(
    () => events.filter((e) => !hiddenCals.has(e.calendar_id) && !isEventHidden(e, hiddenEventKeys)),
    [events, hiddenCals, hiddenEventKeys],
  );

  // ── the two buckets, intelligence picks: projects (lead initiatives, next-up,
  //    deadlines) + inbox (deadlines, faithfulness top-ups). One ranked set. ──
  // the week's projects are the pull's primary source — pass the week so it can
  // read them off On Deck instead of guessing from deadlines
  const suggestions = useMemo(() => suggestPull(data, weekStartISO), [data, weekStartISO]);
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

  // ── layer 0 · standing slots: route matching work into the recurring blocks
  //    you've dedicated (6–8a trading, Tue frontier…) BEFORE anything else is
  //    placed. Cap-don't-cram, spill across occurrences. See docs/standing-slots.
  const standingSlots = useMemo(() => weekSlots.filter(isStandingSlot), [weekSlots]);
  const standingSlotIds = useMemo(() => standingSlots.map((s) => s.id), [standingSlots]);
  const { data: standingChildren = [] } = useSlotTasks(standingSlotIds);
  // minutes already inside each standing slot — a part-full block only takes
  // what it has room for (children carry slot_id, so they're never in keptTasks)
  const occupiedMins = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of standingChildren) {
      if (!t.slot_id || t.status === "done") continue;
      m.set(t.slot_id, (m.get(t.slot_id) ?? 0) + (t.duration_minutes ?? 30));
    }
    return m;
  }, [standingChildren]);
  const routing = useMemo(
    () => routeToStanding(keptTasks, standingSlots, occupiedMins, data),
    [keptTasks, standingSlots, occupiedMins, data],
  );
  // the pool the composer sees excludes work already routed into a standing slot
  const pooledTasks = useMemo(
    () => keptTasks.filter((t) => !routing.routedTaskIds.has(t.id)),
    [keptTasks, routing],
  );
  const routedCount = useMemo(
    () => routing.assignments.reduce((s, a) => s + a.taskIds.length, 0),
    [routing],
  );

  // ── project work is slotted as PROJECT SLOTS, not loose per-task blocks ─────
  // A project's steps belong to one sitting: "Thursday 1–3 is Stampede v3", not
  // four errands scattered across three days. So we cluster the draft's project
  // work into a slot per project (chunked to a sitting) and hand the composer the
  // SLOT as one block; loose work still places per task.
  const projectSlots = useMemo(
    () => clusterWeek(pooledTasks.filter((t) => t.project_id), data),
    [pooledTasks, data],
  );

  // AI-themed runs (the inbox tail + re-bundled carry-forward). They're drafts
  // like everything else here — one board, one set of proposals you can move.
  const [runs, setRuns] = useState<Batch[]>([]);
  const runMemberIds = useMemo(() => new Set(runs.flatMap((r) => r.taskIds)), [runs]);

  // a task inside a run is placed BY the run — it must not also place on its own;
  // routed-into-a-standing-slot work is excluded via pooledTasks
  const looseTasks = useMemo(
    () => pooledTasks.filter((t) => !t.project_id && !runMemberIds.has(t.id)),
    [pooledTasks, runMemberIds],
  );
  const blocks_ = useMemo(() => [...projectSlots, ...runs], [projectSlots, runs]);
  const slotById = useMemo(() => new Map(blocks_.map((b) => [b.id, b])), [blocks_]);
  const composeTasks = useMemo<Task[]>(
    () => [...blocks_.map(synthTask), ...looseTasks],
    [blocks_, looseTasks],
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
        tasks: composeTasks,
        events: visibleEvents,
        blocks: onCalBlocks,
        workStartMin: workStart,
        workEndMin: workEnd,
        focusInitiativeIds: data.focusInitiativeIds,
        dayContexts,
        workingDays,
        weeklyBudgetMins: budget != null ? Math.max(0, budget - blockedMins) : null,
        // a slot holds real tasks — it can't be carved in half
        atomicIds: blocks_.map((b) => b.id),
      }),
    [weekStartISO, today, composeTasks, blocks_, visibleEvents, onCalBlocks, workStart, workEnd, data.focusInitiativeIds, dayContexts, workingDays, budget, blockedMins],
  );

  const gain = useMemo(() => computeGain(data), [data]);

  // Hand-edits on top of Nuvo's auto-placement: a move (day + start) or a resize
  // (duration) per BLOCK. These override the composed placement and ride into the
  // commit, so you build off the suggestion instead of accepting it whole.
  //
  // Keyed per placement, not per task: a split overdue task puts two blocks on the
  // board sharing one task id, so keying by task made them move as one — which is
  // why they were locked. The key is the block; the task id rides along for drop.
  const [overrides, setOverrides] = useState<Record<string, { dayISO: string; startMin: number; durationMin: number }>>({});
  const placements = useMemo(
    () => result.placements.map((p) => {
      const o = overrides[placementKey(p)];
      return o ? { ...p, dayISO: o.dayISO, startMin: o.startMin, durationMin: o.durationMin } : p;
    }),
    [result.placements, overrides],
  );
  const movePlacement = (key: string, dayISO: string, startMin: number) =>
    setOverrides((prev) => {
      const base = result.placements.find((p) => placementKey(p) === key);
      const durationMin = prev[key]?.durationMin ?? base?.durationMin ?? 30;
      return { ...prev, [key]: { dayISO, startMin, durationMin } };
    });
  const resizePlacement = (key: string, durationMin: number) =>
    setOverrides((prev) => {
      const base = result.placements.find((p) => placementKey(p) === key);
      const dayISO = prev[key]?.dayISO ?? base?.dayISO ?? "";
      const startMin = prev[key]?.startMin ?? base?.startMin ?? 0;
      return { ...prev, [key]: { dayISO, startMin, durationMin } };
    });

  const plannedMins = placements.reduce((s, p) => s + p.durationMin, 0) + blockedMins;
  const conf = cal && plannedMins > 0 ? confidence(plannedMins, cal) : null;
  const dropBlock = (taskId: string) => {
    setKept((prev) => new Set([...prev].filter((id) => id !== taskId)));
    setOverrides((prev) => {
      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  // ── theme & slot the inbox: AI groups loose captures into named runs, the
  //    composer drops each run into open time (GTD's "give it a when") ────────
  const inbox = useMemo(() => inboxTasks(data), [data]);
  const [theming, setTheming] = useState(false);
  const [themeErr, setThemeErr] = useState<string | null>(null);
  const themeInbox = async () => {
    if (theming || inbox.length === 0) return;
    setTheming(true);
    setThemeErr(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("agent", {
        body: { clusterInbox: { today } },
      });
      if (error) throw error;
      const groups = (res?.groups ?? []) as InboxGroup[];
      const inboxRows = allTasks.filter((t) => t.status === "inbox");
      if (!groups.length || !inboxRows.length) {
        setThemeErr("Nothing to theme — the inbox came back empty.");
        return;
      }
      // The runs join the DRAFT — they land on the board as proposals you can
      // drag, exactly like a project slot. (They used to be placed behind their
      // own back and shown in a modal: a second scheduler, with its own answer,
      // that you couldn't touch.)
      setRuns((prev) => [...prev, ...clusterInboxRuns(groups, inboxRows, data)]);
    } catch (e) {
      setThemeErr(e instanceof Error ? e.message : "Theming failed");
    } finally {
      setTheming(false);
    }
  };

  // ── re-bundle the carried/slipped work into themed focus blocks ────────────
  // The same AI theming the inbox uses, pointed at this week's slipped tasks: so
  // carry-forward becomes a few named focus blocks (each sized to its members),
  // not a scatter of loose tasks. Lands in the draft, on the board, like the rest.
  const [themingCarried, setThemingCarried] = useState(false);
  const [carriedErr, setCarriedErr] = useState<string | null>(null);
  const themeCarried = async () => {
    if (themingCarried) return;
    const carried = allTasks.filter(
      (t) => (t.roll_count ?? 0) > 0 && t.status !== "done" && t.status !== "trashed" &&
        t.status !== "inbox" && !t.start_time && !t.slot_id && kept.has(t.id),
    );
    if (!carried.length) return;
    setThemingCarried(true);
    setCarriedErr(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("agent", {
        body: { clusterInbox: { today, taskIds: carried.map((t) => t.id) } },
      });
      if (error) throw error;
      const groups = (res?.groups ?? []) as InboxGroup[];
      if (!groups.length) { setCarriedErr("Couldn't bundle the carried work — try again."); return; }
      setRuns((prev) => [...prev, ...clusterInboxRuns(groups, carried, data)]);
    } catch (e) {
      setCarriedErr(e instanceof Error ? e.message : "Bundling failed");
    } finally {
      setThemingCarried(false);
    }
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
  const placedCount = placements.length;

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
    const startISOof = (p: Placement) => {
      const [y, mo, d] = p.dayISO.split("-").map(Number);
      return new Date(y, mo - 1, d, Math.floor(p.startMin / 60), p.startMin % 60).toISOString();
    };
    // A project slot commits as a real Slot holding its tasks; loose work commits
    // as its own block. Both ride the same paths the rest of the app already uses.
    const slotSpecs: { title: string; doDateISO: string; startISO: string; durationMins: number; domainId: string | null; color: string | null; taskIds: string[] }[] = [];
    const taskPlacements: { id: string; doDateISO: string; startISO: string; durationMins: number; splitChild?: { title: string } }[] = [];
    for (const p of placements) {
      const slot = slotById.get(p.task.id);
      if (slot) {
        // a one-task block IS its own time block — schedule the task directly,
        // no slot wrapper; only a genuine multi-task sitting becomes a container
        if (slot.taskIds.length === 1) {
          taskPlacements.push({
            id: slot.taskIds[0],
            doDateISO: p.dayISO,
            startISO: startISOof(p),
            durationMins: p.durationMin,
          });
          continue;
        }
        slotSpecs.push({
          title: slot.name,
          doDateISO: p.dayISO,
          startISO: startISOof(p),
          durationMins: p.durationMin,
          domainId: slot.domainId,
          color: slot.color,
          taskIds: slot.taskIds,
        });
        continue;
      }
      // parts 2+ of a split overdue task are materialized as their own rows
      const isChild = !!p.parts && p.parts > 1 && (p.part ?? 1) > 1;
      taskPlacements.push({
        id: p.task.id,
        doDateISO: p.dayISO,
        startISO: startISOof(p),
        durationMins: p.durationMin,
        ...(isChild ? { splitChild: { title: `${p.task.title} (${p.part}/${p.parts})` } } : {}),
      });
    }
    // commit the pool first (every kept task joins the week), then time it.
    // Run members ride along even if they were never "kept" — an inbox capture
    // swept into a run is joining the week by virtue of being in one.
    const commitTaskIds = [...new Set([...kept, ...runMemberIds])];
    await planWeek({ commitTaskIds, placements: taskPlacements, goal: goal.trim() });
    if (slotSpecs.length) await applySlots(slotSpecs, { sprintId: data.sprint?.id ?? null });
    // layer 0 · file the routed work into its standing slots (sprint_id already
    // stamped by planWeek via commitTaskIds; this sets slot_id + the slot's day)
    if (routing.assignments.length) {
      await assignToStanding(
        routing.assignments.map((a) => ({
          slotId: a.slot.id,
          doDateISO: a.slot.do_date,
          taskIds: a.taskIds,
        })),
        { sprintId: data.sprint?.id ?? null },
      );
    }
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
        <div className="mx-auto max-w-[1080px]">
          {/* ── ACT 1 · set the week — open with the look-back, then the intent ── */}
          {/* hero: ceremony + the gain folded in as the supporting read, not a stray line */}
          <header className="mb-8">
            <div className="section-label"><span style={{ color: "var(--accent)" }}>{sprintLabel(weekStartISO)}</span> · Slot the projects · {planningAhead ? "the week ahead" : "this week"}</div>
            <h1 className="mt-1.5 text-display masthead leading-[1.05]">
              Week of {format(parseDateISO(weekStartISO), "MMMM d")}
            </h1>
            <p className="mt-2.5 text-body text-muted">
              Last 7 days — <span className="text-ink">{gain.doneCount} done · {hrs(gain.doneMins)}h</span>.
              {gain.topMove && (
                <span style={{ color: "var(--accent)" }}> {gain.topMove.name} climbed {gain.topMove.from}→{gain.topMove.to}%.</span>
              )}
              {gain.quiet.length > 0 && (
                <span style={{ color: "var(--signal)" }}> {gain.quiet.join(" & ")} went quiet.</span>
              )}
            </p>
          </header>

          {/* the initiatives — the strategic backdrop; a quiet check above the week's intent */}
          <BetsStrip />

          {/* priorities — the heart: name what would make this week a win */}
          <div className="mt-8"><BigRocks weekStartISO={weekStartISO} /></div>
        </div>
      ) : (
        // ── ACT 2 · shape it — the composed week wide, pull + boundaries railed ──
        <div className="flex flex-col gap-6 lg:flex-row">
          <section className="min-w-0 flex-1">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              {/* no "batch into focus blocks" button: the board already composes
                  project slots and themed runs. A second batcher over the
                  already-committed week was a different answer to the same
                  question, shown in a modal you couldn't edit. */}
              <h2 className="text-head masthead">The week</h2>
              <span className="mono shrink-0 text-meta text-muted">
                {placedCount} placed · {result.unplaced.length} in the pool
                {routedCount > 0 && ` · ${routedCount} in standing slots`}
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
                  placements={placements}
                  slotById={slotById}
                  data={data}
                  workStartMin={workStart}
                  workEndMin={workEnd}
                  dayContexts={dayContexts}
                  onDrop={dropBlock}
                  onMove={movePlacement}
                  onResize={resizePlacement}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-meta text-muted">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2.5 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", borderLeft: "3px solid var(--accent)" }} /> ✦ placed for you</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2.5 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--accent) 26%, transparent)", borderLeft: "4px solid var(--accent)", boxShadow: "inset 3px 0 0 color-mix(in srgb, var(--accent) 45%, transparent)" }} /> ▸ project slot</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2.5 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--accent) 13%, transparent)", borderLeft: "3px solid var(--accent)" }} /> already set ✓</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2.5 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--ink) 5%, transparent)", borderLeft: "2px solid var(--line-strong)" }} /> immovable</span>
                  <span className="mono ml-auto">hover a placed block to drop it</span>
                </div>
              </>
            )}

            {result.unplaced.length > 0 && (
              <div className="mt-3 border-t border-line pt-2.5">
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

          {/* right rail — carry forward → the week's projects → loose inbox.
              That's the order the week is actually owed: debt you already carry,
              then the intent you named, then whatever's discretionary. */}
          <aside className="shrink-0 space-y-5 lg:w-[360px]">
            {/* the candidates — carrying forward, then the projects' work */}
            <Candidates
              suggestions={suggestions}
              kept={kept}
              setKept={setKept}
              data={data}
              onThemeCarried={() => void themeCarried()}
              themingCarried={themingCarried}
              carriedErr={carriedErr}
            />

            {/* clear the inbox — the GTD tail: loose captures get a when. AI finds
                what's like each other, the composer drops each run into open time. */}
            <InboxRun
              count={inbox.length}
              theming={theming}
              error={themeErr}
              onTheme={() => void themeInbox()}
            />

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
      {/* clears the macOS traffic lights + gives a drag handle — stays transparent
          so the one warm-paper canvas reads from the very top (no frost seam) */}
      <div data-tauri-drag-region className="h-8 w-full shrink-0" />
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-2.5">
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
    // The flow is the app's two verbs, twice: slot the projects into the week,
    // then slot their work into days. It used to invent "Set" / "Shape" for these
    // — verbs that appear nowhere else — because we hadn't noticed it was doing
    // the same act at two altitudes.
    { id: "intent", n: 1, label: "Slot the projects" },
    { id: "shape", n: 2, label: "Slot the work" },
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
    <footer className="shrink-0 border-t border-line px-8 py-3">
      <div className="mx-auto flex max-w-[1080px] items-center gap-4">
        <div className="mono min-w-0 flex-1 text-meta text-muted">
          {priorityCount > 0 ? `${priorityCount} priorit${priorityCount === 1 ? "y" : "ies"}` : "no priorities yet"}
          {leadCount > 0 ? ` · ★ ${leadCount} lead${leadCount === 1 ? "" : "s"}` : ""}
          {" — set the intent, then shape the week around it"}
        </div>
        <Btn kind="primary" onClick={onNext} className="shrink-0 px-4 py-2">Slot the work →</Btn>
      </div>
    </footer>
  );
}

// ── the initiatives — ≤3 leads, carried forward; verdicts on the stalled ────────────
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
        <div className="section-label">
          The initiatives <span className="mono normal-case tracking-normal text-muted">· ★ {leads.length}/3 leads</span>
        </div>
        {rows.length > 0 && (
          <button onClick={() => setManage((m) => !m)} className="fast mono text-meta text-muted hover:text-ink">
            {open ? "done" : "adjust"}
          </button>
        )}
      </div>

      {!open ? (
        <div className="flex flex-wrap gap-1.5">
          {leadInits.length === 0 && (
            <span className="text-caption text-muted italic">No lead initiatives — the week runs on faithfulness and deadlines. Tap adjust to pick up to three.</span>
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
            <p className="py-2 text-caption text-muted">
              No active initiatives. Start an initiative on the Initiative floor (⌘4).
            </p>
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
      className="glass-card flex items-center gap-3 rounded-md border px-3.5 py-2.5"
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
            title={lead ? "Remove lead" : leadFull ? "Three leads already" : "Make this a lead initiative"}
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
function InboxRun({
  count,
  theming,
  error,
  onTheme,
}: {
  count: number;
  theming: boolean;
  error: string | null;
  onTheme: () => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-head masthead">
          Clear the inbox{" "}
          <span className="mono text-meta font-normal text-muted">{count} waiting</span>
        </h2>
      </div>

      {count === 0 ? (
        <p className="text-caption text-muted">Inbox is clear — nothing loose to place.</p>
      ) : (
        <>
          <p className="text-caption text-muted">
            {count} loose capture{count === 1 ? "" : "s"} with no time yet. Unlike a Push, these
            don't move a project — group like with like into <span className="text-ink">runs</span> and
            drop each into open time.
          </p>
          <button
            onClick={onTheme}
            disabled={theming}
            className="tap fast mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-caption text-accent hover:bg-accent-soft disabled:opacity-50"
            style={{ background: "var(--accent-soft)" }}
          >
            {theming ? "Grouping into runs…" : `✦ Group ${count} into runs`}
          </button>
          {error && <p className="mt-1.5 text-meta text-signal">{error}</p>}
        </>
      )}
    </section>
  );
}

function Candidates({
  suggestions,
  kept,
  setKept,
  data,
  onThemeCarried,
  themingCarried,
  carriedErr,
}: {
  suggestions: ReturnType<typeof suggestPull>;
  kept: Set<string>;
  setKept: (next: Set<string>) => void;
  data: VerticalData;
  onThemeCarried: () => void;
  themingCarried: boolean;
  carriedErr: string | null;
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

  // Slipped commitments get their own bundle, ABOVE the fresh pull — so the flow
  // asks about carry-forward work plainly instead of folding it into the pull.
  const slipped = suggestions.filter((s) => s.task.rollCount > 0);
  const fresh = suggestions.filter((s) => s.task.rollCount === 0);
  const slippedMins = slipped.reduce((m, s) => m + s.task.durationMins, 0);
  const keptFresh = fresh.filter((s) => kept.has(s.task.id)).length;

  // The fresh pull, split: work belonging to the week's projects (grouped under
  // the project, so you SEE the projects you named) vs everything else.
  const byProject = new Map<string, PullSuggestion[]>();
  const looseFresh: PullSuggestion[] = [];
  for (const s of fresh) {
    const pid = s.projectId;
    if (pid && projectById(data, pid)) {
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid)!.push(s);
    } else looseFresh.push(s);
  }

  // `grouped` rows sit under a heading that already names the project, so the
  // per-row reason ("<project> moves this week") is pure repetition — and long
  // enough to squeeze the task's own title out of the row.
  const renderRow = (s: PullSuggestion, grouped = false) => (
    <CandidateRow
      key={s.task.id}
      on={kept.has(s.task.id)}
      onToggle={() => toggle(s.task.id)}
      color={domainById(data, s.task.domainId)?.color}
      title={s.task.title}
      mins={plannedMinutes(s.task.durationMins, !!s.task.projectId)}
      reason={grouped ? "" : s.reason}
      carried={s.task.rollCount > 0}
    />
  );

  return (
    <section>
      {slipped.length > 0 && (
        <div className="mb-5">
          <div className="mb-2">
            <h2 className="text-head masthead">
              Carrying forward <span className="mono text-meta font-normal text-signal">{slipped.length} slipped · {hrs(slippedMins)}h</span>
            </h2>
            <p className="mt-0.5 text-caption text-muted">
              Work that rolled forward with no time yet. It's already in the week — Nuvo finds it new slots. Uncheck anything you'd rather let go.
            </p>
            <button
              onClick={onThemeCarried}
              disabled={themingCarried}
              title="Group the kept slipped work into a few named focus blocks, each sized to its tasks"
              className="tap fast mt-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption text-accent hover:bg-accent-soft disabled:opacity-50"
              style={{ background: "var(--accent-soft)" }}
            >
              {themingCarried ? "Bundling into focus blocks…" : "✦ Bundle into focus blocks"}
            </button>
            {carriedErr && <p className="mt-1 text-meta text-signal">{carriedErr}</p>}
          </div>
          <div className="space-y-1">{slipped.map((s) => renderRow(s))}</div>
        </div>
      )}

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-head masthead">
          The projects <span className="mono text-meta font-normal text-muted">{keptFresh}/{fresh.length} in the week</span>
        </h2>
        <button onClick={() => setShowMore((s) => !s)} className="fast mono text-meta text-muted hover:text-ink">
          {showMore ? "hide" : "＋ add more"}
        </button>
      </div>

      {byProject.size === 0 && looseFresh.length === 0 && slipped.length === 0 && (
        <p className="py-1 text-caption text-muted">
          No projects on deck for this week, and nothing urgent to pull. Slot a project in the step before this.
        </p>
      )}

      {/* the week's projects, each with its own open work — the point of the week */}
      {[...byProject.entries()].map(([pid, rows]) => {
        const proj = projectById(data, pid)!;
        const color = domainById(data, proj.domainId)?.color ?? "var(--accent)";
        const on = rows.filter((r) => kept.has(r.task.id)).length;
        const mins = rows
          .filter((r) => kept.has(r.task.id))
          .reduce((m, r) => m + plannedMinutes(r.task.durationMins, true), 0);
        const allOn = on === rows.length;
        return (
          <div key={pid} className="mb-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-body">{proj.name}</span>
              <button
                onClick={() => {
                  const next = new Set(kept);
                  rows.forEach((r) => (allOn ? next.delete(r.task.id) : next.add(r.task.id)));
                  setKept(next);
                }}
                className="fast mono shrink-0 text-micro text-muted hover:text-accent"
              >
                {allOn ? "none" : "all"}
              </button>
              <span className="mono shrink-0 text-micro text-muted">{on}/{rows.length} · {hrs(mins)}h</span>
            </div>
            <div className="space-y-1">{rows.map((r) => renderRow(r, true))}</div>
          </div>
        );
      })}

      {looseFresh.length > 0 && (
        <div className="space-y-1">{looseFresh.map((s) => renderRow(s))}</div>
      )}

      {showMore && (
        <div className="mt-2 max-h-[34vh] overflow-y-auto border-t border-line pt-2">
          <div className="section-label mb-1">Inbox &amp; backlog ({more.length})</div>
          {more.length === 0 && <div className="px-2 py-3 text-center text-label text-muted">Nothing else waiting.</div>}
          {more.map((t) => (
            <CandidateRow
              key={t.id}
              on={kept.has(t.id)}
              onToggle={() => toggle(t.id)}
              color={domainById(data, t.domainId)?.color}
              title={t.title || "untitled"}
              mins={plannedMinutes(t.durationMins, !!t.projectId)}
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
      className="tap fast flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left"
      style={{ background: on ? "var(--accent-soft)" : "transparent" }}
    >
      <span
        className="mono flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-micro"
        style={{
          background: on ? "var(--accent)" : "transparent",
          border: on ? "none" : "1px solid var(--line)",
          color: on ? "#fff" : "var(--muted)",
        }}
      >
        {on ? "✓" : ""}
      </span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color ?? "var(--line)" }} />
      <span className="min-w-0 flex-1 truncate text-caption" style={{ opacity: on ? 1 : 0.62 }}>
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
    <section className="border-t border-line pt-3">
      <button onClick={onToggle} className="fast flex w-full items-center justify-between text-left">
        <span className="section-label">Boundaries</span>
        <span className="mono text-meta text-muted">
          {workingLabel} · {toMinLabel(workStart)}–{toMinLabel(workEnd)} · click to {open ? "hide" : "adjust"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
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
    <footer className="shrink-0 border-t border-line px-8 py-3">
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
  /** The originating task row (== id for whole blocks; the shared base for split
   *  pieces). Used for drop/remove, which acts on the whole task. */
  taskId?: string;
  /** Project-backed work reads as a "project slot" — significant, not errand
   *  time. Carries the project name as an eyebrow above the title. */
  project?: string | null;
  /** how many tasks this block holds — set only on a project slot */
  holds?: number;
  /** Set on an overdue task carved across sittings — this piece is 1 of N. */
  split?: { part: number; parts: number };
}

function WeekGrid({
  days,
  events,
  slots,
  locked,
  placements,
  slotById,
  data,
  workStartMin,
  workEndMin,
  dayContexts,
  onDrop,
  onMove,
  onResize,
}: {
  days: { iso: string; past: boolean }[];
  events: ExternalEvent[];
  slots: Slot[];
  locked: Task[];
  placements: Placement[];
  /** placements whose "task" is really a project slot, by synthetic id */
  slotById: Map<string, Batch>;
  data: VerticalData;
  workStartMin: number;
  workEndMin: number;
  dayContexts: Record<string, DayContext>;
  onDrop: (taskId: string) => void;
  onMove: (taskId: string, dayISO: string, startMin: number) => void;
  onResize: (taskId: string, durationMin: number) => void;
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
    const split = p.parts && p.parts > 1 ? { part: p.part!, parts: p.parts } : undefined;
    // a project slot's "task" is the sitting itself — its title IS the project,
    // and the tasks it holds are the detail
    const slot = slotById.get(p.task.id);
    add(p.dayISO, {
      // the block's identity — split pieces share a task id, so they key by part
      id: placementKey(p),
      taskId: p.task.id,
      kind: "new",
      startMin: p.startMin,
      endMin: p.startMin + p.durationMin,
      title: p.task.title,
      color: taskDomainColor(data, p.task),
      reason: p.reason,
      project: p.task.project_id ? projectById(data, p.task.project_id)?.name ?? null : null,
      holds: slot ? slot.taskIds.length : undefined,
      split,
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

  // ── hand-editing — drag a placed block to move it, drag its edge to resize ──
  // Pointer events (Tauri swallows HTML5 DnD). The held block lifts into glass and
  // the destination column highlights — the drag-and-hold contract (design-language).
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<
    | { id: string; mode: "move" | "resize"; title: string; hue: string; dayISO: string; startMin: number; durationMin: number; grabOffsetMin: number }
    | null
  >(null);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);
  const drag = dragRef.current;

  const snap = (m: number) => Math.round(m / 15) * 15;
  const minAt = (clientY: number, colTop: number) => lo + ((clientY - colTop) / HOUR_PX) * 60;
  const colTopOf = (iso: string) => {
    const el = colRefs.current.get(iso);
    return el ? el.getBoundingClientRect().top : 0;
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === "move") {
        let targetISO = d.dayISO;
        for (const [iso, el] of colRefs.current) {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX < r.right) { targetISO = iso; break; }
        }
        let start = snap(minAt(e.clientY, colTopOf(targetISO)) - d.grabOffsetMin);
        start = Math.max(lo, Math.min(hi - d.durationMin, start));
        d.dayISO = targetISO;
        d.startMin = start;
      } else {
        let end = snap(minAt(e.clientY, colTopOf(d.dayISO)));
        end = Math.max(d.startMin + 15, Math.min(hi, end));
        d.durationMin = end - d.startMin;
      }
      bump();
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === "move") onMove(d.id, d.dayISO, d.startMin);
      else onResize(d.id, d.durationMin);
      dragRef.current = null;
      bump();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [lo, hi, onMove, onResize]);

  const startDrag = (e: React.PointerEvent, it: GridItem, dayISO: string, mode: "move" | "resize") => {
    e.preventDefault();
    if (mode === "resize") e.stopPropagation();
    const grabOffsetMin = mode === "move" ? minAt(e.clientY, colTopOf(dayISO)) - it.startMin : 0;
    dragRef.current = {
      id: it.id, mode, title: it.title, hue: it.color ?? "var(--accent)",
      dayISO, startMin: it.startMin, durationMin: it.endMin - it.startMin, grabOffsetMin,
    };
    bump();
  };

  return (
    <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: "62vh" }}>
      {/* day headers — sticky frosted glass so they stay legible over the scroll,
          without painting an opaque seam over the warm-paper canvas */}
      <div
        className="sticky top-0 z-10 flex border-b border-line"
        style={{ background: "color-mix(in srgb, var(--surface) 72%, transparent)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
      >
        <div className="w-[52px] shrink-0" />
        {days.map((d) => {
          const ctx = dayContexts[d.iso] ?? "normal";
          return (
            <div key={d.iso} className="min-w-[150px] flex-1 border-l border-line px-2 py-2 text-center" style={{ opacity: d.past ? 0.4 : 1 }}>
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
            <div
              key={d.iso}
              ref={(el) => { if (el) colRefs.current.set(d.iso, el); }}
              className="relative min-w-[150px] flex-1 border-l border-line"
              style={{
                opacity: d.past ? 0.5 : 1,
                background: drag?.mode === "move" && drag.dayISO === d.iso ? "color-mix(in srgb, var(--accent) 7%, transparent)" : undefined,
              }}
            >
              {hours.map((h, i) =>
                i === 0 ? null : <div key={h} className="absolute inset-x-0" style={{ top: yOf(h), borderTop: "1px solid var(--line)", opacity: 0.5 }} />,
              )}
              {items.map((it) => {
                const top = yOf(it.startMin);
                const height = Math.max(MIN_BLOCK_PX, yOf(it.endMin) - yOf(it.startMin));
                if (it.kind === "event") {
                  // immovable external commitments — a quiet neutral frost, no identity
                  return (
                    <div
                      key={`ev-${it.id}`}
                      className="absolute inset-x-1 overflow-hidden rounded-[5px] px-1.5 py-0.5"
                      style={{
                        top, height,
                        background: "color-mix(in srgb, var(--ink) 5%, transparent)",
                        borderLeft: "2px solid var(--line-strong)",
                        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                      }}
                      title={it.title}
                    >
                      <div className="mono truncate text-micro leading-tight text-muted">{it.title}</div>
                    </div>
                  );
                }
                const isNew = it.kind === "new";
                const isSlot = it.kind === "slot";
                const isProject = isNew && !!it.project; // a "project slot" — significant work
                const isSplit = isNew && !!it.split; // an overdue task carved across sittings
                // everything Nuvo places is a proposal you can move — including a
                // split sitting (overrides key per block, so pieces move apart)
                const draggable = isNew;
                const hue = it.color ?? "var(--accent)";
                const dragging = drag?.id === it.id;
                const moveSource = dragging && drag!.mode === "move";
                const resizing = dragging && drag!.mode === "resize";
                const endMin = resizing ? it.startMin + drag!.durationMin : it.endMin;
                const blkTop = yOf(it.startMin);
                const blkHeight = Math.max(MIN_BLOCK_PX, yOf(endMin) - yOf(it.startMin));
                // Tinted glass: the domain hue read through, with its color as the
                // left identity edge and ink text — never a solid white-on-color slab.
                // Placed-for-you (new) reads as Nuvo's intent: a touch stronger + lift.
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    onPointerDown={draggable ? (e) => startDrag(e, it, d.iso, "move") : undefined}
                    className={`group lift-anim absolute inset-x-1 overflow-hidden rounded-[6px] px-1.5 py-1 ${draggable ? "cursor-grab" : ""}`}
                    style={{
                      top: blkTop, height: blkHeight,
                      color: "var(--ink)",
                      background: `color-mix(in srgb, ${hue} ${isProject ? 26 : isNew ? 22 : isSlot ? 18 : 13}%, transparent)`,
                      borderLeft: `${isProject ? 4 : 3}px solid ${hue}`,
                      borderTop: moveSource ? "1px dashed var(--line-strong)" : undefined,
                      opacity: moveSource ? 0.3 : isNew || isSlot ? 1 : 0.85,
                      backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
                      // a project slot lifts a touch more — a real push, not errand time
                      boxShadow: !isNew || moveSource ? "none" : isProject ? `var(--shadow-lift), inset 3px 0 0 color-mix(in srgb, ${hue} 45%, transparent)` : "var(--shadow-lift)",
                      touchAction: draggable ? "none" : undefined,
                    }}
                    title={draggable ? `drag to move · drag the bottom edge to resize${isSplit ? " · one sitting of a split" : ""}` : isSlot ? "focus block — your batched work" : "already on the calendar — locked"}
                  >
                    {/* the eyebrow names the project — pointless on a project SLOT,
                        whose own title is already the project name */}
                    {isProject && !it.holds && blkHeight > 34 && (
                      <div
                        className="section-label truncate leading-none"
                        style={{ color: hue, letterSpacing: "0.06em" }}
                        title={it.project ?? undefined}
                      >
                        {it.project}
                      </div>
                    )}
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1 truncate text-meta font-semibold leading-tight">
                        {isSlot ? `⛶ ${it.title}` : isProject ? `▸ ${it.title}` : isNew ? `✦ ${it.title}` : it.title}
                      </div>
                      {isNew ? (
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onDrop(it.taskId ?? it.id)}
                          className="fast shrink-0 text-caption leading-none text-muted opacity-0 hover:text-signal group-hover:opacity-100"
                          title={isSplit ? "Remove the whole overdue task from the week" : "Remove from the week"}
                        >
                          ×
                        </button>
                      ) : isSlot ? null : (
                        <span className="shrink-0 text-micro leading-none text-muted">✓</span>
                      )}
                    </div>
                    {blkHeight > 30 && (
                      <div className="mono truncate text-micro leading-tight text-muted">
                        {fmtMinShort(it.startMin)}–{fmtMinShort(endMin)}
                        {it.holds ? ` · ${it.holds} task${it.holds === 1 ? "" : "s"}` : ""}
                        {isSplit && <span className="text-signal"> · sitting {it.split!.part}/{it.split!.parts}</span>}
                      </div>
                    )}
                    {draggable && (
                      <div
                        onPointerDown={(e) => startDrag(e, it, d.iso, "resize")}
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        style={{ touchAction: "none" }}
                        title="Drag to resize"
                      />
                    )}
                  </div>
                );
              })}
              {drag?.mode === "move" && drag.dayISO === d.iso && (
                <div
                  className="glass-grab pointer-events-none absolute inset-x-1 overflow-hidden rounded-[6px] px-1.5 py-1"
                  style={{
                    top: yOf(drag.startMin),
                    height: Math.max(MIN_BLOCK_PX, yOf(drag.startMin + drag.durationMin) - yOf(drag.startMin)),
                    color: "var(--ink)",
                    background: `color-mix(in srgb, ${drag.hue} 26%, transparent)`,
                    borderLeft: `3px solid ${drag.hue}`,
                    zIndex: 30,
                  }}
                >
                  <div className="truncate text-meta font-semibold leading-tight">✦ {drag.title}</div>
                  <div className="mono text-micro text-muted">{fmtMinShort(drag.startMin)}–{fmtMinShort(drag.startMin + drag.durationMin)}</div>
                </div>
              )}
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
        <div className="mono mb-2 text-micro uppercase tracking-wide" style={{ color: "var(--accent)" }}>{sprintLabel()}</div>
        <div className="text-display masthead">Your week is set.</div>
        {data.sprintGoal && <div className="mt-2 text-head text-muted">“{data.sprintGoal}”</div>}
        <div className="mono mt-3 text-label text-muted">
          {hrs(totalMins)}h committed · {committed.length} tasks · {split.length} domain{split.length === 1 ? "" : "s"} · ★ {data.focusInitiativeIds.length} lead initiative{data.focusInitiativeIds.length === 1 ? "" : "s"}
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
