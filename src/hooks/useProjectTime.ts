// Deferring a project — the span write AND the calendar it leaves behind.
//
// "Take it off this week" used to clear the project's dates and stop. Its
// sitting stayed on the grid with every task inside, so the slate said the
// project was gone while Thursday still promised it — and the rollover then
// dragged that work into Today each morning. The acts here are the whole
// deferral: the kernel's span patch, the kernel's clearing, one undo.
//
// Every surface that takes a project off a week comes through `useDeferProject`
// (the Schedule's slot, the Week's Plan row, Plan the week on both shells, the
// deck, the record, the record menus). The chat applies the same kernel plan
// with the service role (`delete_priority`). Never write a bare span patch to
// take a project off a week — that is the bug this file exists to end.

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, startOfDay } from "date-fns";
import { fetchSlotsRange, slotsKey, useSlotMutations, useSlots } from "./useSlots";
import { useAllTasks, useTaskMutations } from "./useTasks";
import { useOptionalUndoStack } from "./useUndoStack";
import { useOptionalVertical } from "./useVertical";
import { planningWeekStartISO, toDateISO } from "../lib/dates";
import { projectById, type Project } from "../lib/vertical";
import type { RecordKind, RecordWeekActs } from "../lib/recordActions";
import type { Slot, Task } from "../lib/types";
import { span } from "../components/mobile/dayPlan";
import {
  NO_COST,
  costPhrase,
  projectTimeCost,
  slotTimeCost,
  type TimeCost,
} from "../lib/projectTime";
import {
  deferralClearRange,
  isOnDeckThisWeek,
  pushToNextWeekPatch,
  releasedTaskPatch,
  takeOffWeekPatch,
} from "../../supabase/functions/_shared/planningRules.ts";

export type DeferAct = "take_off" | "next_week";

/** Open-ended on purpose: taking a project off its week clears everything
 *  ahead, and a real range key keeps this query inside every slot-cache helper
 *  (they place a slot by comparing its start against the key's bounds). */
const FAR = "9999-12-31T00:00:00.000Z";
const aheadRange = () => ({ start: startOfDay(new Date()).toISOString(), end: FAR });

/** The key `useAheadSlots` reads — exported so a fixture harness can seed it. */
export const aheadSlotsKey = () => {
  const { start, end } = aheadRange();
  return slotsKey(start, end);
};

/** Every slot from today forward — the calendar a deferral can touch. */
export function useAheadSlots() {
  const today = toDateISO(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const range = useMemo(aheadRange, [today]);
  return useSlots(range.start, range.end);
}

/** What a deferral would clear, live — for the sentence said before the press. */
export function useProjectTimeCost(projectId: string | null | undefined, act: DeferAct, weekStartISO: string): TimeCost {
  const { data: tasks } = useAllTasks();
  const { data: slots } = useAheadSlots();
  return useMemo(() => {
    if (!projectId || !tasks || !slots) return NO_COST;
    return projectTimeCost(projectId, deferralClearRange(act, weekStartISO, toDateISO(new Date())), tasks, slots);
  }, [projectId, act, weekStartISO, tasks, slots]);
}

/** What freeing one block would clear. */
export function useSlotTimeCost(slot: Slot | null | undefined): TimeCost {
  const { data: tasks } = useAllTasks();
  return useMemo(() => (slot && tasks ? slotTimeCost(slot, tasks) : NO_COST), [slot, tasks]);
}

/** Resolve within `ms`, else `null` — a paused (offline) query never settles,
 *  and an act must not wait on the network to do what the cache already knows. */
function soon<T>(p: Promise<T>, ms = 2500): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => window.setTimeout(() => r(null), ms))]);
}

export function useDeferProject() {
  const qc = useQueryClient();
  const store = useOptionalVertical();
  const taskMutations = useTaskMutations();
  const slotMutations = useSlotMutations();
  const { recordUndo } = useOptionalUndoStack();

  const cachedTasks = useCallback((): Task[] => {
    const all = qc.getQueryData<Task[]>(["tasks", "all"]);
    if (all) return all;
    const seen = new Map<string, Task>();
    for (const [, rows] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
      if (Array.isArray(rows)) for (const t of rows) seen.set(t.id, t);
    }
    return [...seen.values()];
  }, [qc]);

  const aheadSlots = useCallback(async (): Promise<Slot[]> => {
    const { start, end } = aheadRange();
    const key = slotsKey(start, end);
    const warm = qc.getQueryData<Slot[]>(key);
    if (warm) return warm;
    const fetched = navigator.onLine
      ? await soon(qc.fetchQuery({ queryKey: key, queryFn: () => fetchSlotsRange(start, end) }))
      : null;
    if (fetched) return fetched;
    // Offline and never warmed: whatever ranges the calendar has on hand.
    const seen = new Map<string, Slot>();
    for (const [, rows] of qc.getQueriesData<Slot[]>({ queryKey: ["slots"] })) {
      if (Array.isArray(rows)) for (const s of rows) seen.set(s.id, s);
    }
    return [...seen.values()];
  }, [qc]);

  /** Apply a clearing. Returns the exact inverse, for the caller's ONE undo. */
  const applyCost = useCallback(
    (cost: TimeCost): (() => void) => {
      // The same four fields every other place-act restores (D-063a).
      const before = cost.tasks.map((t) => ({
        id: t.id,
        status: t.status,
        do_date: t.do_date,
        start_time: t.start_time,
        slot_id: t.slot_id,
      }));
      cost.tasks.forEach((t) =>
        taskMutations.patchTask(t.id, releasedTaskPatch(Boolean(t.project_id)), { undo: false }),
      );
      cost.removed.forEach((s) => slotMutations.removeSlot(s));

      return () => {
        // A slot's id is minted on create, so a restored block is a new row —
        // the work is pointed at the block that replaced the one it was in.
        const reborn = new Map<string, string>();
        for (const s of cost.removed) {
          const next = slotMutations.createSlot({
            title: s.title,
            do_date: s.do_date,
            start_time: s.start_time,
            duration_minutes: s.duration_minutes,
            project_id: s.project_id,
            domain_id: s.domain_id,
            color: s.color,
          });
          reborn.set(s.id, next.id);
        }
        before.forEach(({ id, ...snap }) =>
          taskMutations.patchTask(
            id,
            { ...snap, slot_id: snap.slot_id ? reborn.get(snap.slot_id) ?? snap.slot_id : null },
            { undo: false },
          ),
        );
      };
    },
    [taskMutations, slotMutations],
  );

  /** The span write, then the clearing, as one undoable act. */
  const defer = useCallback(
    async (project: Project, act: DeferAct, weekStartISO: string, patch: Partial<Project>, verb: string) => {
      if (!store) return;
      const before = { startDate: project.startDate, targetDate: project.targetDate, status: project.status };
      // The span moves on the press; the calendar follows once its rows are in
      // hand (a microtask when the Schedule has been open, which is the usual case).
      store.updateProject(project.id, patch);
      const slots = await aheadSlots();
      const cost = projectTimeCost(
        project.id,
        deferralClearRange(act, weekStartISO, toDateISO(new Date())),
        cachedTasks(),
        slots,
      );
      const restore = applyCost(cost);
      const phrase = costPhrase(cost);
      recordUndo({
        label: phrase ? `${verb} — ${phrase} off the calendar` : verb,
        shortLabel: verb,
        tier: "toast",
        undo: () => {
          store.updateProject(project.id, before);
          restore();
        },
      });
    },
    [store, aheadSlots, cachedTasks, applyCost, recordUndo],
  );

  /**
   * Off the week entirely — back to needing a week, and everything of it still
   * ahead comes off the calendar. `extra` lets a surface keep the status it has
   * always written alongside (the deck shelves to `backlog`).
   */
  const takeOff = useCallback(
    (project: Project, weekStartISO: string = planningWeekStartISO(), extra: Partial<Project> = {}) =>
      defer(project, "take_off", weekStartISO, { ...takeOffWeekPatch(), ...extra }, `Took “${project.name}” off the week`),
    [defer],
  );

  /** The whole project to next week; the rest of THIS week comes off the calendar. */
  const pushOut = useCallback(
    (project: Project, weekStartISO: string = planningWeekStartISO()) =>
      defer(
        project,
        "next_week",
        weekStartISO,
        pushToNextWeekPatch(project, weekStartISO),
        `Moved “${project.name}” to next week`,
      ),
    [defer],
  );

  /** Free ONE block. The project stays on its week; the work inside goes loose. */
  const freeSlot = useCallback(
    (slot: Slot) => {
      const cost = slotTimeCost(slot, cachedTasks());
      const restore = applyCost(cost);
      const start = new Date(slot.start_time);
      const when = `${format(start, "EEE")} ${span(start, new Date(start.getTime() + slot.duration_minutes * 60_000))}`;
      const n = cost.tasks.length;
      recordUndo({
        label: n ? `Freed ${when} — ${n} task${n === 1 ? "" : "s"} loose again` : `Freed ${when}`,
        shortLabel: "Freed the block",
        tier: "toast",
        undo: restore,
      });
    },
    [cachedTasks, applyCost, recordUndo],
  );

  return { takeOff, pushOut, freeSlot };
}

/** The record menus' week acts — present only for a project that is on the
 *  planning week, so a project with no week isn't offered a way off one. */
export function useRecordWeekActs(kind: RecordKind, id: string): RecordWeekActs | null {
  const store = useOptionalVertical();
  const { takeOff, pushOut } = useDeferProject();
  const weekISO = store?.data.sprint?.week_start ?? planningWeekStartISO();
  const project = kind === "project" && store ? projectById(store.data, id) : null;
  const onWeek = !!project && isOnDeckThisWeek(project, weekISO);
  const cost = useProjectTimeCost(onWeek ? id : null, "next_week", weekISO);
  if (!project || !onWeek) return null;
  return {
    cleared: costPhrase(cost),
    pushOut: () => void pushOut(project, weekISO),
    takeOff: () => void takeOff(project, weekISO),
  };
}
