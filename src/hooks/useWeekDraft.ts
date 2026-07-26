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
import { isEventHidden } from "../lib/now";
import { clusterInboxRuns, clusterWeek, synthTask, type Batch, type InboxGroup } from "../lib/batch";
import { isStandingSlot, routeToStanding } from "../lib/standingSlots";
import { supabase } from "../lib/supabase";
import { calibrate, confidence, weeklyBudgetMins } from "../lib/calibration";
import { suggestPull } from "../lib/pull";
import type { Task } from "../lib/types";

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
  const { settings } = useSettings();
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
        atomicIds: draftBlocks.map((b) => b.id),
      }),
    [weekStartISO, today, composeTasks, draftBlocks, visibleEvents, onCalBlocks, workStart, workEnd, data.focusInitiativeIds, dayContexts, workingDays, budget, blockedMins],
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

  // ── theme & slot the inbox: AI groups loose captures into named runs, the
  //    composer drops each run into open time (GTD's "give it a when") ────────
  const inbox = useMemo(() => inboxTasks(data), [data]);
  const [theming, setTheming] = useState(false);
  const [themeErr, setThemeErr] = useState<string | null>(null);
  const themeInbox = useCallback(async () => {
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
  }, [theming, inbox.length, today, allTasks, data]);

  // ── re-bundle the carried/slipped work into themed focus blocks ────────────
  // The same AI theming the inbox uses, pointed at this week's slipped tasks: so
  // carry-forward becomes a few named focus blocks (each sized to its members),
  // not a scatter of loose tasks. Lands in the draft, on the board, like the rest.
  const [themingCarried, setThemingCarried] = useState(false);
  const [carriedErr, setCarriedErr] = useState<string | null>(null);
  const themeCarried = useCallback(async () => {
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
  }, [themingCarried, allTasks, kept, today, data]);

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
    // the pull
    suggestions,
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
    // the calendar the week lands in
    visibleEvents,
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
    themeInbox,
    theming,
    themeErr,
    themeCarried,
    themingCarried,
    carriedErr,
    // the commit
    goal,
    setGoal,
    commit,
    applying,
    committed,
  };
}
