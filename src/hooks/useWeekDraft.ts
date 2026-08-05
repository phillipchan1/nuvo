// The week's draft — everything "plan the week" is, minus the pixels.
//
// Lifted out of SundayRitual so the desktop ritual and the phone's Plan the week
// run the SAME act: one pull, one router into standing slots, one clustering into
// project slots, one composer, one commit. Two surfaces that each computed their
// own week would be two answers to "what is my week" — the exact failure the On
// Deck derivation exists to prevent (docs/on-deck.md, lib/priorities.ts).
//
// The rule of the split: this hook owns everything that decides WHAT the week is
// (pull → route → cluster → compose → commit). A surface owns only how it's laid
// out and which gestures reach it — the desktop grid drags and resizes; the phone
// taps. Both write through `commit()` below.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, subDays } from "date-fns";
import { useVertical } from "./useVertical";
import { useSettings } from "./useSettings";
import { useWorkingDays } from "./useWorkingDays";
import { useExternalEvents } from "./useCalendar";
import { useSlots, useSlotTasks } from "./useSlots";
import { useAllTasks, useScheduledTasks } from "./useTasks";
import {
  faithfulness,
  inboxTasks,
  initiativeProgress,
  initiativeProgressAt,
  isProjectInFlight,
  sprintTasks,
  type VerticalData,
} from "../lib/vertical";
import { parseDateISO, planningWeekStartISO, todayISO } from "../lib/dates";
import { composeWeek, type DayContext, type Placement } from "../lib/compose";
import { eventInstanceKey, eventSeriesKey, isEventHidden } from "../lib/now";
import { clusterInboxRuns, clusterWeek, synthTask, type Batch, type InboxGroup } from "../lib/batch";
import { isStandingSlot, routeToStanding } from "../lib/standingSlots";
import { supabase } from "../lib/supabase";
import { calibrate, confidence, weeklyBudgetMins } from "../lib/calibration";
import { laneOf, readIntake, type WeekLane } from "../lib/intake";
import { suggestPull } from "../lib/pull";
import type { ExternalEvent, Slot, Task } from "../lib/types";

/** One board block's identity. A split overdue task yields several blocks that
 *  share a task id, so the BLOCK — not the task — is what you move and resize. */
export const placementKey = (p: Placement) =>
  p.parts && p.parts > 1 ? `${p.task.id}#${p.part}` : p.task.id;

/** The gain, compressed to a glance — the look-back both surfaces open with. */
export function computeGain(data: VerticalData) {
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

export type WeekDraft = ReturnType<typeof useWeekDraft>;

export function useWeekDraft() {
  const { data, planWeek, applySlots, assignToStanding } = useVertical();
  const { settings, update: updateSettings } = useSettings();
  const { data: allTasks = [] } = useAllTasks();

  const [committed, setCommitted] = useState(false);
  const [applying, setApplying] = useState(false);
  const [goal, setGoal] = useState(data.sprintGoal ?? "");
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
  const reviewableEvents = useMemo(() => events.filter((e) => !hiddenCals.has(e.calendar_id)), [events, hiddenCals]);

  // ── the two buckets, intelligence picks: projects (lead initiatives, next-up,
  //    deadlines) + inbox (deadlines, faithfulness top-ups). One ranked set. ──
  // the week's projects are the pull's primary source — pass the week so it can
  // read them off On Deck instead of guessing from deadlines
  const suggestions = useMemo(() => suggestPull(data, weekStartISO), [data, weekStartISO]);
  const [kept, setKept] = useState<Set<string>>(new Set());
  /**
   * Every id we've *offered* — not every id currently kept. The difference is the
   * whole point: an id we've already offered and that isn't in `kept` was dropped
   * by the person, and must never be re-added behind their back.
   *
   * This used to be a single `seeded` boolean that latched on the first non-empty
   * pull. But `useVertical` streams — projects, tasks and the sprint arrive over
   * several renders — so a slow load would seed from a *partial* pull (say, two
   * loose ends), latch, and then never take in the twelve pieces of project work
   * that arrived a moment later. You'd open Plan the week to a slate with nothing
   * kept and a week with nothing on it. Seeding additively is immune to the
   * arrival order, which is the only thing that was ever really being relied on.
   */
  const offered = useRef<Set<string>>(new Set());
  useEffect(() => {
    // the pull, PLUS anything already committed-but-unplaced (re-entry recomposes
    // the existing week pool instead of dropping it)
    const pool = sprintTasks(data).filter((t) => t.status === "ready").map((t) => t.id);
    const fresh = [...suggestions.map((s) => s.task.id), ...pool].filter((id) => !offered.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => offered.current.add(id));
    setKept((prev) => new Set([...prev, ...fresh]));
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
  const draftBlocks = useMemo(() => [...projectSlots, ...runs], [projectSlots, runs]);
  const slotById = useMemo(() => new Map(draftBlocks.map((b) => [b.id, b])), [draftBlocks]);
  const composeTasks = useMemo<Task[]>(
    () => [...draftBlocks.map(synthTask), ...looseTasks],
    [draftBlocks, looseTasks],
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

  // ── what you moved by hand is a boundary, not a decoration ────────────────
  //
  // A move (day + start) or a resize (duration), per BLOCK. Keyed per placement,
  // not per task: a split overdue task puts two blocks on the board sharing one
  // task id, so keying by task made them move as one.
  //
  // **They are fed back into the canvas.** They used to be applied *after* the
  // compose, as a cosmetic patch over its answer — so the composer went on
  // believing your project still sat where it had put it, and the next step
  // dropped tasks straight on top of where you had actually dragged it. A block
  // you placed yourself is now as immovable as a meeting, and everything after
  // it is composed around it. Every step recomposes, so a change on one step is
  // visible on the next.
  const [overrides, setOverrides] = useState<Record<string, { dayISO: string; startMin: number; durationMin: number }>>({});
  const pinned = useMemo(() => {
    const byId = new Map(composeTasks.map((t) => [t.id, t]));
    const out: { task: Task; dayISO: string; startMin: number; durationMin: number }[] = [];
    for (const [key, o] of Object.entries(overrides)) {
      // a dragged *part* of a split task can't be pinned without stranding its
      // siblings — those keep the old cosmetic behaviour
      if (key.includes("#")) continue;
      const task = byId.get(key);
      if (task) out.push({ task, ...o });
    }
    return out;
  }, [overrides, composeTasks]);
  const pinnedIds = useMemo(() => new Set(pinned.map((p) => p.task.id)), [pinned]);
  /** Your blocks, in the shape the composer reads immovable time in. */
  const pinnedBlocks = useMemo<Task[]>(
    () =>
      pinned.map(
        (p) =>
          ({
            id: p.task.id,
            title: p.task.title,
            duration_minutes: p.durationMin,
            start_time: `${p.dayISO}T${String(Math.floor(p.startMin / 60)).padStart(2, "0")}:${String(p.startMin % 60).padStart(2, "0")}:00`,
            status: "backlog",
          }) as unknown as Task,
      ),
    [pinned],
  );

  // ── compose-on-open: the schedule recomputes from the draft, live ──────────
  const result = useMemo(
    () =>
      composeWeek({
        weekStartISO,
        todayISO: today,
        now: new Date(),
        tasks: composeTasks.filter((t) => !pinnedIds.has(t.id)),
        events: visibleEvents,
        blocks: [...onCalBlocks, ...pinnedBlocks],
        workStartMin: workStart,
        workEndMin: workEnd,
        focusInitiativeIds: data.focusInitiativeIds,
        dayContexts,
        workingDays,
        /**
         * **The calendar is the constraint; the pace is commentary.**
         *
         * This used to pass `provenPace − alreadyBlocked` as a hard ceiling, so
         * the composer refused work once the week passed a number the operator
         * had never set, never seen derived, and could not see on any surface —
         * it surfaced only as "past the ~12h/wk you've actually been finishing"
         * next to a visibly empty Thursday. A silent refusal is the app deciding
         * (Principle 4), and it was deciding with a hidden model against the
         * plain evidence of the calendar.
         *
         * Calibration keeps its job — `CapacityMeter` still says how far past
         * your usual week this plan runs, in `--signal`, while you decide, which
         * is the honest answer to A4 ("am I lying to myself about this week?").
         * It just doesn't get to enforce it. Work is placed into the open time
         * that actually exists.
         */
        weeklyBudgetMins: null,
        // a slot holds real tasks — it can't be carved in half
        atomicIds: draftBlocks.map((b) => b.id),
      }),
    [weekStartISO, today, composeTasks, draftBlocks, visibleEvents, onCalBlocks, pinnedIds, pinnedBlocks, workStart, workEnd, data.focusInitiativeIds, dayContexts, workingDays],
  );

  const gain = useMemo(() => computeGain(data), [data]);

  // ── the intake — which of the three sources this week's weight comes from ──
  // Both shells draw the same funnel off this, so "Projects · Leftovers · Inbox"
  // can never mean two different things on two screens (lib/intake.ts).
  const intakeTasks = useMemo(() => {
    const seen = new Set(keptTasks.map((t) => t.id));
    // captures swept into a themed run join the week without ever being "kept" —
    // they're weight either way, so the funnel has to count them
    return [...keptTasks, ...allTasks.filter((t) => runMemberIds.has(t.id) && !seen.has(t.id))];
  }, [keptTasks, allTasks, runMemberIds]);
  const intake = useMemo(
    () => readIntake(intakeTasks, { blockedMins, budgetMins: budget ?? null }),
    [intakeTasks, blockedMins, budget],
  );
  /** Which lane any piece of work belongs to, by id — the one lane rule
   *  (`laneOf`) applied to the raw rows, so a *composed block* can be traced back
   *  to the source it came from. */
  const laneByTaskId = useMemo(() => {
    const m = new Map<string, WeekLane>();
    for (const t of allTasks) m.set(t.id, laneOf(t));
    return m;
  }, [allTasks]);
  const laneOfTaskId = useCallback(
    (id: string): WeekLane => laneByTaskId.get(id) ?? "loose",
    [laneByTaskId],
  );
  /**
   * Which source a composed block came from. This is what lets the week reveal
   * itself one source at a time — you see the projects land in an otherwise empty
   * week, then the leftovers fill in around them, then the inbox.
   *
   * A slot or a themed run takes the lane of the work it holds (its members are
   * all one source by construction: `clusterWeek` groups a project's tasks,
   * `clusterWeek` groups a project's tasks, `slotLooseWork` groups everything else).
   */
  const placementLane = useCallback(
    (p: Placement): WeekLane => {
      const block = slotById.get(p.task.id);
      const id = block?.taskIds[0] ?? p.task.id;
      return laneByTaskId.get(id) ?? laneOf(p.task);
    },
    [slotById, laneByTaskId],
  );
  /** The lane a themed run belongs to — carried work vs raw captures. */
  const runLane = useCallback(
    (b: Batch): WeekLane => laneOfTaskId(b.taskIds[0] ?? ""),
    [laneOfTaskId],
  );

  /** The pull, split into the three lanes the flow's steps edit. A suggestion's
   *  lane is decided in exactly one place (`laneOf`), so the funnel's arithmetic
   *  and the step you edit it on can never disagree. */
  const byLane = useMemo(() => {
    const out = { projects: [] as typeof suggestions, loose: [] as typeof suggestions, inbox: [] as typeof suggestions };
    for (const s of suggestions) out[laneOf(s.task)].push(s);
    return out;
  }, [suggestions]);

  const placements = useMemo<Placement[]>(
    () => [
      ...result.placements,
      // your own blocks, re-materialized at the position you put them in
      ...pinned.map((p) => ({
        task: p.task,
        dayISO: p.dayISO,
        startMin: p.startMin,
        durationMin: p.durationMin,
        reason: "you placed this",
      })),
    ],
    [result.placements, pinned],
  );
  const movePlacement = (key: string, dayISO: string, startMin: number) =>
    setOverrides((prev) => {
      const base = placements.find((p) => placementKey(p) === key);
      const durationMin = prev[key]?.durationMin ?? base?.durationMin ?? 30;
      return { ...prev, [key]: { dayISO, startMin, durationMin } };
    });
  const resizePlacement = (key: string, durationMin: number) =>
    setOverrides((prev) => {
      const base = placements.find((p) => placementKey(p) === key);
      const dayISO = prev[key]?.dayISO ?? base?.dayISO ?? "";
      const startMin = prev[key]?.startMin ?? base?.startMin ?? 0;
      return { ...prev, [key]: { dayISO, startMin, durationMin } };
    });

  const plannedMins = placements.reduce((s, p) => s + p.durationMin, 0) + blockedMins;
  const conf = cal && plannedMins > 0 ? confidence(plannedMins, cal) : null;
  /** Drop a block off the draft. The id is the BLOCK's — for a project slot or a
   *  themed run that's the synthetic block id, so resolve it back to the real
   *  tasks it holds; otherwise dropping a sitting silently kept every task in it
   *  and the block simply recomposed. */
  const dropBlock = (blockId: string) => {
    const block = slotById.get(blockId);
    const ids = new Set(block ? block.taskIds : [blockId]);
    setKept((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    setRuns((prev) => prev.filter((r) => r.id !== blockId));
    setOverrides((prev) => {
      if (!prev[blockId]) return prev;
      const next = { ...prev };
      delete next[blockId];
      return next;
    });
  };

  // ── slot the loose work: ONE pass over everything that isn't project work ──
  //
  // Carried leftovers and raw captures used to be themed in two separate calls,
  // so a "Frontier" leftover and a "Frontier" capture came back in two different
  // slots — the AI never saw them together and had no way to know they belonged
  // in one sitting. They are the same kind of thing (a carried task *was* a
  // capture once; the difference is provenance, not kind), so they're slotted as
  // one pool. Slotting is not a decision either — the decision is whether you
  // agree with the slots — so it runs on arrival, like the pull and the compose.
  const inbox = useMemo(() => inboxTasks(data), [data]);
  const [theming, setTheming] = useState(false);
  const [themeErr, setThemeErr] = useState<string | null>(null);

  /** Every loose piece the week is carrying — captures and leftovers alike. */
  const loosePool = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          !t.project_id &&
          !t.start_time &&
          !t.slot_id &&
          t.status !== "done" &&
          t.status !== "trashed" &&
          (t.status === "inbox" || kept.has(t.id)),
      ),
    [allTasks, kept],
  );

  const slotLooseWork = useCallback(async () => {
    if (theming || loosePool.length === 0) return;
    setTheming(true);
    setThemeErr(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("agent", {
        body: { clusterInbox: { today, taskIds: loosePool.map((t) => t.id) } },
      });
      if (error) throw error;
      const groups = (res?.groups ?? []) as InboxGroup[];
      if (!groups.length) {
        setThemeErr("Nothing came back to slot — try again.");
        return;
      }
      // The runs join the DRAFT — proposals on the board you can drag or take
      // apart, never a second scheduler with its own answer.
      setRuns(clusterInboxRuns(groups, loosePool, data));
    } catch (e) {
      setThemeErr(e instanceof Error ? e.message : "Slotting failed");
    } finally {
      setTheming(false);
    }
  }, [theming, loosePool, today, data]);

  const autoSlotted = useRef(false);
  useEffect(() => {
    if (autoSlotted.current || theming || loosePool.length === 0) return;
    autoSlotted.current = true;
    void slotLooseWork();
  }, [loosePool.length, theming, slotLooseWork]);


  /**
   * Take a task out of the block it was grouped into. AI grouping is a proposal,
   * and a proposal you can't correct is a decision made for you (Principle 3) —
   * a capture themed "Frontier" that's really SCE has to be rescuable before it
   * rides onto the calendar under the wrong name. The freed task simply places on
   * its own; the block shrinks by its duration, or disappears if it was the last.
   */
  const removeFromRun = useCallback((runId: string, taskId: string) => {
    setRuns((prev) =>
      prev
        .map((r) => {
          if (r.id !== runId) return r;
          const taskIds = r.taskIds.filter((id) => id !== taskId);
          const mins = allTasks.find((t) => t.id === taskId)?.duration_minutes ?? 30;
          return { ...r, taskIds, durationMins: Math.max(15, r.durationMins - mins) };
        })
        .filter((r) => r.taskIds.length > 0),
    );
  }, [allTasks]);

  // ── reclaiming time — an event you won't attend isn't capacity ────────────
  // Nuvo already knows how to ignore one (`hidden_events` + `isEventHidden`, read
  // by every availability path); planning day is simply when you'd want to say
  // so, because it's the moment the answer changes what you commit to.
  const hiddenEvent = useCallback(
    (e: ExternalEvent) => isEventHidden(e, hiddenEventKeys),
    [hiddenEventKeys],
  );
  const toggleEventHidden = useCallback(
    (e: ExternalEvent) => {
      const key = eventInstanceKey(e);
      const current = settings?.hidden_events ?? [];
      const on = isEventHidden(e, hiddenEventKeys);
      // Hiding uses the instance key; un-hiding has to clear a series key too, or
      // a series-hidden occurrence could never be brought back from here.
      const seriesKey = eventSeriesKey(e);
      const next = on
        ? current.filter((h) => h.key !== key && (seriesKey == null || h.key !== seriesKey))
        : [...current, { key, title: e.title || "busy" }];
      void updateSettings({ hidden_events: next });
    },
    [settings, hiddenEventKeys, updateSettings],
  );

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

  const commit = async () => {
    setApplying(true);
    const startISOof = (p: Placement) => {
      const [y, mo, d] = p.dayISO.split("-").map(Number);
      return new Date(y, mo - 1, d, Math.floor(p.startMin / 60), p.startMin % 60).toISOString();
    };
    // A project slot commits as a real Slot holding its tasks; loose work commits
    // as its own block. Both ride the same paths the rest of the app already uses.
    const slotSpecs: { title: string; doDateISO: string; startISO: string; durationMins: number; domainId: string | null; color: string | null; projectId: string | null; existingSlotId: string | null; taskIds: string[] }[] = [];
    // A project's sitting already on this week's calendar. Re-planning mid-week
    // recomposes only the work that has no time yet (`keptTasks` drops anything
    // with a slot_id or a start_time), so without this lookup the fresh batch
    // became a SECOND slot with the same project title sitting beside the first.
    // Standing slots are excluded: those are dedications the routing pass owns,
    // not sittings this commit created.
    const sittingByProject = new Map<string, Slot>();
    for (const s of weekSlots) {
      if (!s.project_id || isStandingSlot(s)) continue;
      if (!sittingByProject.has(s.project_id)) sittingByProject.set(s.project_id, s);
    }
    const taskPlacements: { id: string; doDateISO: string; startISO: string; durationMins: number; splitChild?: { title: string } }[] = [];
    for (const p of placements) {
      const slot = slotById.get(p.task.id);
      if (slot) {
        // Already has a sitting this week → grow that one and file the new work
        // into it, rather than standing a twin next to it.
        const sitting = slot.projectId ? sittingByProject.get(slot.projectId) ?? null : null;
        // a one-task block IS its own time block — schedule the task directly,
        // no slot wrapper; only a genuine multi-task sitting becomes a container.
        // Unless the project already HAS a sitting: then the lone new task is
        // one more piece of that sitting, not a second block for the same work.
        if (slot.taskIds.length === 1 && !sitting) {
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
          doDateISO: sitting?.do_date ?? p.dayISO,
          startISO: sitting?.start_time ?? startISOof(p),
          durationMins: sitting ? (sitting.duration_minutes ?? 0) + p.durationMin : p.durationMin,
          domainId: slot.domainId,
          color: slot.color,
          // `Batch.projectId` is set when every member belongs to one project —
          // exactly when this sitting IS that project's. Carry it onto the row.
          projectId: slot.projectId,
          existingSlotId: sitting?.id ?? null,
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

  return {
    // the week itself
    data,
    weekStartISO,
    today,
    planningAhead,
    fromGate,
    weekDays,
    gridDays,
    workingDays,
    setWorkingDays,
    dayContexts,
    workStart,
    workEnd,
    // reclaiming open time — an event you won't attend isn't capacity
    hiddenEvent,
    toggleEventHidden,
    // the pull — whole, and split into the flow's three lanes
    suggestions,
    byLane,
    intake,
    laneOfTaskId,
    placementLane,
    runLane,
    kept,
    setKept,
    keptTasks,
    keptCount: keptTasks.length,
    dropBlock,
    // standing slots + slot blocks
    routing,
    routedCount,
    slotById,
    runs,
    removeFromRun,
    // the calendar the week lands in
    visibleEvents,
    /** The week's events with individually-set-aside ones still IN, so a step can
     *  offer them back — but calendars you've hidden in Settings stay out. Those
     *  are hidden app-wide and permanently; re-litigating them every planning day
     *  is how a 39-event week showed up as an 89-row list. */
    allWeekEvents: reviewableEvents,
    weekSlots,
    onCalBlocks,
    blockedMins,
    // the composed shape
    result,
    placements,
    movePlacement,
    resizePlacement,
    plannedMins,
    cal,
    conf,
    gain,
    // AI theming
    inboxCount: inbox.length,
    loosePool,
    slotLooseWork,
    theming,
    themeErr,
    // the commit
    goal,
    setGoal,
    commit,
    applying,
    committed,
  };
}
