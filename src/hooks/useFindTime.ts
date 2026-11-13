// useFindTime — "this project has open work with no time this week; where does
// it go?" The manual half of an act that only ever existed inside the weekly
// ritual.
//
// `suggestPull` knows that a week's on-deck projects' open work IS the point of
// the week, and it had exactly one caller: the plan draft. So a task added to an
// in-week project on a Wednesday landed nowhere — the project stayed on the
// slate (membership is the derived span), while its new work sat off the week,
// off the calendar, and outside the project's own sitting. The Week's Plan row
// could see it (`weekPlacement().looseMins`) and could only offer to give up on
// it: another week, next week, off the week. This is the missing act.
//
// It invents no scheduling rule. `composeWeek` (lib/compose) does the placing,
// exactly as the ritual does, over the same busy-time read every other surface
// uses. What's local is only the scope: one project's loose work, against what
// is left of this week.

import { useCallback, useMemo } from "react";
import { addDays, startOfWeek } from "date-fns";
import { useVertical } from "./useVertical";
import { useSettings } from "./useSettings";
import { useWorkingDays } from "./useWorkingDays";
import { useExternalEvents } from "./useCalendar";
import { useAllTasks, useScheduledTasks } from "./useTasks";
import { useSlots } from "./useSlots";
import { parseDateISO, toDateISO, todayISO } from "../lib/dates";
import { isPlacedInWeek } from "../lib/priorities";
import { asBusyBlock, composeWeek, slotsAsBusy, type Placement } from "../lib/compose";
import { isEventHidden } from "../lib/now";
import type { Task } from "../lib/types";

const WORK_START_DEFAULT = 480;
const WORK_END_DEFAULT = 990;

export interface FindTimeProposal {
  placements: Placement[];
  /** Loose work the week genuinely had no room for — stated, never hidden. */
  unplaced: Task[];
  /** Every loose task considered, placed or not. */
  considered: Task[];
}

/** A piece of a project that HAS a time this week, and when. */
export interface PlacedPiece {
  task: Task;
  /** when it happens — its own block, or the sitting it rides */
  startISO: string;
  /** set when it has no block of its own: the sitting holding it */
  slotTitle: string | null;
}

/** Just the reading half — which of a project's pieces have no time this week.
 *
 *  Split out from `useFindTime` because the Schedule's rail crown lists loose
 *  work on every render of the app's main screen, and it has no use for the
 *  calendar events that only the *composer* needs. Listing shouldn't pay for
 *  placing. */
export function useLooseWork(weekStartISO: string) {
  const { data: allTasks = [] } = useAllTasks();

  const range = useMemo(() => {
    const start = parseDateISO(weekStartISO);
    return { start: start.toISOString(), end: addDays(start, 7).toISOString() };
  }, [weekStartISO]);

  const { data: blocks = [] } = useScheduledTasks(range.start, range.end);
  // Slot children hold a time the blocks query can't see (they carry
  // `start_time: null`), so without the slots the composer would happily place
  // new work on top of a sitting that is already spoken for.
  const { data: slots = [] } = useSlots(range.start, range.end);

  /** A project's open work, cut in two by the one question that matters this
   *  week: does it have a time, or not?
   *
   *  Deliberately ONE pass rather than two filters. The two halves are shown side
   *  by side, so a task appearing in both — or in neither — is a visible lie, and
   *  two independently-written predicates is exactly how that happens. Shares
   *  `isPlacedInWeek` with `weekPlacement`, so the lists and the row's
   *  "Xh has a time · Xh loose" are the same claim.
   *
   *  Note what counts as loose: work blocked into ANOTHER week. It isn't
   *  happening here. */
  const splitFor = useCallback(
    (projectId: string): { placed: PlacedPiece[]; loose: Task[] } => {
      const weekSlotIds = new Set(slots.map((s) => s.id));
      const weekBlockTaskIds = new Set(blocks.map((b) => b.id));
      const slotById = new Map(slots.map((s) => [s.id, s]));
      const placed: PlacedPiece[] = [];
      const loose: Task[] = [];

      for (const t of allTasks) {
        if (t.project_id !== projectId) continue;
        if (t.status === "done" || t.status === "trashed") continue;
        if (!isPlacedInWeek(t.id, t.slot_id, weekBlockTaskIds, weekSlotIds)) {
          loose.push(t);
          continue;
        }
        // Where it actually happens. A slot child carries no `start_time` of its
        // own — it rides the sitting's block — so the sitting is the honest
        // answer to "when", and naming it explains why the task has no time of
        // its own without making that read like a fault.
        const sitting = t.slot_id ? slotById.get(t.slot_id) ?? null : null;
        const startISO = t.start_time ?? sitting?.start_time ?? null;
        if (!startISO) continue; // placed but unreadable — say nothing rather than guess
        placed.push({ task: t, startISO, slotTitle: t.start_time ? null : sitting?.title ?? null });
      }

      placed.sort((a, b) => a.startISO.localeCompare(b.startISO));
      return { placed, loose };
    },
    [allTasks, slots, blocks],
  );

  const looseFor = useCallback((projectId: string) => splitFor(projectId).loose, [splitFor]);

  return { splitFor, looseFor, blocks, slots, range };
}

export function useFindTime(weekStartISO: string) {
  const { data: vertical, applySchedule, ensureWeek } = useVertical();
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();
  const { looseFor, blocks: timedBlocks, slots, range } = useLooseWork(weekStartISO);
  // a slot is busy time too — a sitting already on Tuesday isn't free for new work
  const blocks = useMemo(() => [...timedBlocks, ...slotsAsBusy(slots)], [timedBlocks, slots]);

  const { data: events = [] } = useExternalEvents(range.start, range.end);

  const hiddenCals = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const hiddenEventKeys = useMemo(
    () => new Set((settings?.hidden_events ?? []).map((h) => h.key)),
    [settings],
  );
  // A hidden calendar is not "busy" — counting it makes the week look full when
  // it isn't. Same rule the plan draft applies.
  const visibleEvents = useMemo(
    () => events.filter((e) => !hiddenCals.has(e.calendar_id) && !isEventHidden(e, hiddenEventKeys)),
    [events, hiddenCals, hiddenEventKeys],
  );

  /** Propose — never write. The person presses to promote it (P3). */
  const propose = useCallback(
    (projectId: string, now: Date): FindTimeProposal => {
      const considered = looseFor(projectId);
      if (!considered.length) return { placements: [], unplaced: [], considered };
      const res = composeWeek({
        weekStartISO,
        todayISO: todayISO(now),
        now,
        tasks: considered,
        events: visibleEvents,
        blocks,
        workStartMin: settings?.work_start_minutes ?? WORK_START_DEFAULT,
        workEndMin: settings?.work_end_minutes ?? WORK_END_DEFAULT,
        focusInitiativeIds: vertical.focusInitiativeIds,
        workingDays,
        // Deliberately no weekly budget: this is work whose project you have
        // already committed to this week. Calibration reports, it never refuses
        // (the same call the ritual makes).
        weeklyBudgetMins: null,
      });
      const placedIds = new Set(res.placements.map((p) => p.task.id));
      return {
        placements: res.placements,
        unplaced: considered.filter((t) => !placedIds.has(t.id)),
        considered,
      };
    },
    [looseFor, weekStartISO, visibleEvents, blocks, settings, vertical.focusInitiativeIds, workingDays],
  );

  /** Promote the proposal. The sprint is ensured first: a `do_date` written with
   *  no `sprint_id` walks work past the Week gate (P2). */
  const place = useCallback(
    async (placements: Placement[]) => {
      if (!placements.length) return;
      const sprintId = await ensureWeek();
      await applySchedule(
        placements.map((p) => {
          const d = parseDateISO(p.dayISO);
          d.setHours(Math.floor(p.startMin / 60), p.startMin % 60, 0, 0);
          return {
            id: p.task.id,
            doDateISO: p.dayISO,
            startISO: d.toISOString(),
            durationMins: p.durationMin,
          };
        }),
        { sprintId },
      );
    },
    [applySchedule, ensureWeek],
  );

  return { propose, place, looseFor };
}

/** How many of today's loose tasks Find time is asked about at once. The rail
 *  shows three offers at most, so asking about more is work nobody sees. */
export const HOLDS_CAP = 6;

/** Find time for today's tasks with no time (D-205 · "Hold <time>"): where
 *  each would go today — or, when today has no room for it, the next open time
 *  later THIS week (D-206: "Hold Mon 9–9:30am"). The same composer, the same
 *  busy read and working hours as `useFindTime`: today first, then the rest of
 *  the week's working days with today's holds already counted as busy, so two
 *  offers never claim the same half hour. Proposes, never writes (P3). A task
 *  with no fit this week gets no entry, and so no chip.
 *
 *  Mount it only where the offers can show: it reads the week's calendar. */
export function useTodayHolds(tasks: readonly Task[], now: Date): Map<string, Placement> {
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();
  const today = todayISO(now);
  const range = useMemo(() => {
    const monday = startOfWeek(parseDateISO(today), { weekStartsOn: 1 });
    return { weekStartISO: toDateISO(monday), start: monday.toISOString(), end: addDays(monday, 7).toISOString() };
  }, [today]);
  const { data: timed = [] } = useScheduledTasks(range.start, range.end);
  const { data: slots = [] } = useSlots(range.start, range.end);
  const { data: events = [] } = useExternalEvents(range.start, range.end);
  // Minutes, not the Date: the rail's clock ticks, and a fit only moves when
  // the quarter hour does.
  const nowKey = Math.floor(now.getTime() / 60_000);

  return useMemo(() => {
    const pool = tasks.slice(0, HOLDS_CAP);
    if (!pool.length) return new Map<string, Placement>();
    const hiddenCals = new Set(settings?.hidden_calendar_ids ?? []);
    const hiddenKeys = new Set((settings?.hidden_events ?? []).map((h) => h.key));
    const visible = events.filter((e) => !hiddenCals.has(e.calendar_id) && !isEventHidden(e, hiddenKeys));
    const at = new Date(nowKey * 60_000);
    const busy = [...timed, ...slotsAsBusy(slots)];
    const compose = (pending: Task[], days: number[], held: Task[]) =>
      composeWeek({
        weekStartISO: range.weekStartISO,
        todayISO: today,
        now: at,
        tasks: pending,
        events: visible,
        blocks: [...busy, ...held],
        workStartMin: settings?.work_start_minutes ?? WORK_START_DEFAULT,
        workEndMin: settings?.work_end_minutes ?? WORK_END_DEFAULT,
        focusInitiativeIds: [],
        workingDays: days,
        weeklyBudgetMins: null,
      });
    // Today first: the task is already dated today, so today is where a hold
    // belongs when it fits.
    const out = new Map<string, Placement>();
    for (const p of compose(pool as Task[], [parseDateISO(today).getDay()], []).placements)
      if (p.dayISO === today && !p.parts) out.set(p.task.id, p);
    // Then, for what today can't hold, the next opening later this week — the
    // days after today up to Sunday that you work. Today's holds ride as busy,
    // so nothing is claimed twice. Pressing it moves the task's day too.
    const rest = pool.filter((t) => !out.has(t.id)) as Task[];
    if (rest.length) {
      const later: number[] = [];
      const sunday = addDays(parseDateISO(range.weekStartISO), 6);
      for (let d = addDays(parseDateISO(today), 1); d <= sunday; d = addDays(d, 1))
        if (workingDays.includes(d.getDay())) later.push(d.getDay());
      if (later.length) {
        const held = [...out.values()].map((p) => asBusyBlock(`hold-${p.task.id}`, p.task.title, p.dayISO, p.startMin, p.durationMin));
        for (const p of compose(rest, later, held).placements)
          if (p.dayISO > today && !p.parts && !out.has(p.task.id)) out.set(p.task.id, p);
      }
    }
    return out;
  }, [tasks, timed, slots, events, settings, range.weekStartISO, today, nowKey, workingDays]);
}
