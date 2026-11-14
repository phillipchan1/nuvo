// The planner, staying with the week (docs/plan-the-week-v2.md §7).
//
// A committed week breaks in two ways: a meeting lands on a block, or a block's
// time passes with the work undone. When it does, the SAME composer that drew
// the week proposes the smallest repair — this block, somewhere else, everything
// else untouched (a churn budget of one: only the block that broke moves). It
// speaks only when the week broke, never to "optimise" a week that's fine (P9).
//
// How much it does on its own is the dial (lib/planDial): Ask stages nothing
// until you press Re-plan; Suggest stages and waits for ✓; Handle applies and
// offers Undo — on trial, Q-14 open.
//
// Writes go through the app's own mutations (tasks: `block`; slots:
// `updateSlot`) — the same acts a drag on the Schedule makes.

import { useMemo } from "react";
import { startOfWeek } from "date-fns";
import { alternativesFor, asBusyBlock, type ComposeInput, type Placement } from "../lib/compose";
import { isEventHidden } from "../lib/now";
import { toDateISO } from "../lib/dates";
import { isMissed } from "../../supabase/functions/_shared/planningRules";
import type { ExternalEvent, Slot, Task } from "../lib/types";

export type RepairWhy = "landed" | "missed";

export interface Repair {
  /** stable across renders: the row + the time it broke at */
  key: string;
  kind: "task" | "slot";
  id: string;
  title: string;
  why: RepairWhy;
  /** the meeting that landed on it */
  event?: string;
  from: { dayISO: string; startMin: number; durationMin: number };
  /** the composer's answers, best first */
  options: Placement[];
  task?: Task;
  slot?: Slot;
}

const minsOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function useWeekRepair({
  tasks,
  events,
  slots,
  hiddenCalendarIds,
  hiddenEventKeys,
  workStartMin,
  workEndMin,
  workingDays,
  now,
  enabled,
}: {
  tasks: Task[];
  events: ExternalEvent[];
  slots: Slot[];
  hiddenCalendarIds: string[];
  hiddenEventKeys: string[];
  workStartMin: number;
  workEndMin: number;
  workingDays: number[];
  now: Date;
  enabled: boolean;
}): Repair[] {
  // re-read once a minute, not on every tick of `now`
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    if (!enabled) return [];
    const at = new Date(minute * 60_000);
    const weekStart = startOfWeek(at, { weekStartsOn: 1 });
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    const weekStartISO = toDateISO(weekStart);
    const todayISO = toDateISO(at);
    const hiddenCals = new Set(hiddenCalendarIds);
    const hiddenKeys = new Set(hiddenEventKeys);
    const inWeek = (d: Date) => d >= weekStart && d < weekEnd;

    // what counts as a meeting that can break a block: timed, visible, not declined
    const meetings = events.filter(
      (e) =>
        !e.all_day &&
        e.busy !== false &&
        !hiddenCals.has(e.calendar_id) &&
        !isEventHidden(e, hiddenKeys) &&
        e.self_rsvp !== "declined" &&
        inWeek(new Date(e.start_at)),
    );
    const meetingOn = (s: Date, e: Date) =>
      meetings.find((m) => new Date(m.start_at) < e && new Date(m.end_at) > s);

    // The start of the next block after `endMs` on the same day — once you've
    // moved on to it, the one before is behind you (the kernel's missed rule).
    const starts: number[] = [];
    for (const t of tasks) if (t.start_time && t.status !== "trashed") starts.push(new Date(t.start_time).getTime());
    for (const m of meetings) starts.push(new Date(m.start_at).getTime());
    for (const sl of slots) if (sl.start_time) starts.push(new Date(sl.start_time).getTime());
    starts.sort((a, b) => a - b);
    const nextStartAfter = (endMs: number): number | null => {
      const dayEnd = new Date(endMs);
      dayEnd.setHours(24, 0, 0, 0);
      for (const st of starts) if (st >= endMs && st < dayEnd.getTime()) return st;
      return null;
    };

    type Broken = Omit<Repair, "options">;
    const broken: Broken[] = [];
    for (const t of tasks) {
      if (!t.start_time || t.status === "done" || t.status === "trashed" || t.slot_id || t.recurrence_id) continue;
      const s = new Date(t.start_time);
      if (!inWeek(s)) continue;
      const dur = t.duration_minutes ?? 30;
      const e = new Date(s.getTime() + dur * 60_000);
      const from = { dayISO: toDateISO(s), startMin: minsOf(s), durationMin: dur };
      if (e <= at) {
        // Ended undone. It counts as missed once the kernel says so (D-207) —
        // a block you're finishing late isn't flagged mid-act.
        if (isMissed(e.getTime(), at.getTime(), nextStartAfter(e.getTime())))
          broken.push({ key: `task:${t.id}@${t.start_time}`, kind: "task", id: t.id, title: t.title, why: "missed", from, task: t });
        continue;
      }
      const m = meetingOn(s, e);
      if (m) broken.push({ key: `task:${t.id}@${t.start_time}`, kind: "task", id: t.id, title: t.title, why: "landed", event: m.title || "A meeting", from, task: t });
    }
    for (const sl of slots) {
      if (!sl.start_time || sl.recurrence_id) continue;
      const s = new Date(sl.start_time);
      if (!inWeek(s)) continue;
      const e = new Date(s.getTime() + sl.duration_minutes * 60_000);
      if (e <= at) continue; // a slot's work is its tasks; a passed slot isn't re-placed here
      const m = meetingOn(s, e);
      if (m)
        broken.push({
          key: `slot:${sl.id}@${sl.start_time}`,
          kind: "slot",
          id: sl.id,
          title: sl.title || "Slot",
          why: "landed",
          event: m.title || "A meeting",
          from: { dayISO: toDateISO(s), startMin: minsOf(s), durationMin: sl.duration_minutes },
          slot: sl,
        });
    }
    if (!broken.length) return [];

    // every OTHER block on the week holds still; only the broken one is asked about
    const blocksExcept = (skip: string): Task[] => [
      ...tasks.filter((t) => t.start_time && t.status !== "done" && t.status !== "trashed" && t.id !== skip && inWeek(new Date(t.start_time))),
      ...slots
        .filter((sl) => sl.start_time && sl.id !== skip && inWeek(new Date(sl.start_time)))
        .map((sl) => {
          const s = new Date(sl.start_time);
          return asBusyBlock(`slot-${sl.id}`, sl.title ?? "", toDateISO(s), minsOf(s), sl.duration_minutes);
        }),
    ];
    const base: Omit<ComposeInput, "blocks"> = {
      weekStartISO,
      todayISO,
      now: at,
      tasks: [],
      events: meetings,
      workStartMin,
      workEndMin,
      focusInitiativeIds: [],
      dayContexts: {},
      workingDays,
      weeklyBudgetMins: null,
    };

    const out: Repair[] = [];
    // the staged repairs are placed in turn, so two of them never pick one hour
    const taken: Task[] = [];
    for (const b of broken.slice(0, 6)) {
      const asTask = (b.task
        ? { ...b.task, start_time: null, duration_minutes: b.from.durationMin }
        : ({ id: b.id, title: b.title, duration_minutes: b.from.durationMin, project_id: b.slot?.project_id ?? null, status: "backlog", energy: null } as unknown as Task));
      const options = alternativesFor({ ...base, blocks: [...blocksExcept(b.id), ...taken] }, asTask, b.from, 4);
      if (!options.length) continue;
      const first = options[0];
      taken.push(asBusyBlock(`taken-${b.id}`, "", first.dayISO, first.startMin, first.durationMin));
      out.push({ ...b, options });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tasks, events, slots, hiddenCalendarIds, hiddenEventKeys, workStartMin, workEndMin, workingDays, minute]);
}
