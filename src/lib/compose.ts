// The Week Composer — the intelligence at the heart of the Sunday flow.
// Input: the committed week + the boundaries (immovable calendar events,
// working hours, what's already blocked). Output: a proposed, fully
// time-blocked week with a reason on every placement. Pure and deterministic
// so it is instant, testable, and honest — the assistant can re-rank or
// post-process it later, but the schedule itself never hallucinates.
//
// Encoded practice (the boundaries of the intelligence):
//   · deep work lands in the morning, max two deep blocks a day
//   · a 15m breather follows every deep block of an hour or more
//   · decide-work lands late morning / early afternoon (judgment, not flow)
//   · quick + delegate work is batched into afternoon runs, same project
//     kept adjacent (one context, many small wins)
//   · deadlines schedule before their due day; lead-★ bets schedule earliest
//   · no day is filled past ~75% of its free time — slack is the plan
//   · 10m buffer around every immovable event

import { addDays, format } from "date-fns";
import type { ExternalEvent, Task } from "./types";
import { endOf, parseDateISO } from "./dates";
import type { Energy } from "./energy";

export interface Placement {
  task: Task;
  dayISO: string;
  startMin: number; // minutes from local midnight
  durationMin: number;
  reason: string;
}

export interface ComposeDay {
  dayISO: string;
  label: string; // "Mon 16"
  freeMins: number;
  placedMins: number;
}

export interface ComposeResult {
  placements: Placement[];
  unplaced: { task: Task; reason: string }[];
  days: ComposeDay[];
}

export interface ComposeInput {
  weekStartISO: string; // Monday of the planning week
  todayISO: string;
  now: Date;
  tasks: Task[]; // the committed pool: not done, no start_time yet
  events: ExternalEvent[]; // busy events intersecting the week (immovable)
  blocks: Task[]; // already time-blocked tasks in the week (immovable)
  workStartMin: number;
  workEndMin: number;
  focusInitiativeIds: string[];
}

const EVENT_BUFFER = 10; // minutes around immovable events
const BREAK_AFTER_DEEP = 15; // breather after a long deep block
const DAY_FILL_CAP = 0.75; // never plan a day past this share of free time
const SNAP = 15;

interface Slot { start: number; end: number }

const snapUp = (m: number) => Math.ceil(m / SNAP) * SNAP;
const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const hh = ((h + 11) % 12) + 1;
  return mm === 0 ? `${hh}${ampm}` : `${hh}:${String(mm).padStart(2, "0")}${ampm}`;
};

/** Local calendar day + minutes-from-midnight of an instant. */
function minutesOn(iso: string): { day: string; start: number } {
  const d = new Date(iso);
  return { day: format(d, "yyyy-MM-dd"), start: d.getHours() * 60 + d.getMinutes() };
}

export function composeWeek(input: ComposeInput): ComposeResult {
  const { weekStartISO, todayISO, now, workStartMin, workEndMin } = input;
  const monday = parseDateISO(weekStartISO);
  const focus = new Set(input.focusInitiativeIds);

  // ── 1 · the canvas: free slots per day inside working hours ───────────────
  const busyByDay = new Map<string, Slot[]>();
  const addBusy = (day: string, start: number, end: number) => {
    if (!busyByDay.has(day)) busyByDay.set(day, []);
    busyByDay.get(day)!.push({ start, end });
  };
  for (const e of input.events) {
    if (!e.busy || e.all_day) continue;
    const s = minutesOn(e.start_at);
    const end = new Date(e.end_at);
    const endDay = format(end, "yyyy-MM-dd");
    if (s.day === endDay) {
      addBusy(s.day, s.start - EVENT_BUFFER, end.getHours() * 60 + end.getMinutes() + EVENT_BUFFER);
    } else {
      addBusy(s.day, s.start - EVENT_BUFFER, 24 * 60);
      addBusy(endDay, 0, end.getHours() * 60 + end.getMinutes() + EVENT_BUFFER);
    }
  }
  for (const b of input.blocks) {
    if (!b.start_time) continue;
    const s = minutesOn(b.start_time);
    const e = endOf({ start_time: b.start_time, duration_minutes: b.duration_minutes });
    addBusy(s.day, s.start, e.getHours() * 60 + e.getMinutes());
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const days: { iso: string; slots: Slot[]; free: number; placed: number; deepCount: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = format(addDays(monday, i), "yyyy-MM-dd");
    if (iso < todayISO) continue; // the past is a boundary too
    let windowStart = workStartMin;
    if (iso === todayISO) windowStart = Math.max(workStartMin, snapUp(nowMin + SNAP));
    if (windowStart >= workEndMin) continue;
    const busy = (busyByDay.get(iso) ?? []).sort((a, b) => a.start - b.start);
    const slots: Slot[] = [];
    let cursor = windowStart;
    for (const b of busy) {
      if (b.end <= cursor) continue;
      if (b.start > cursor) slots.push({ start: cursor, end: Math.min(b.start, workEndMin) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= workEndMin) break;
    }
    if (cursor < workEndMin) slots.push({ start: cursor, end: workEndMin });
    const free = slots.reduce((s, x) => s + Math.max(0, x.end - x.start), 0);
    if (free >= SNAP) days.push({ iso, slots, free, placed: 0, deepCount: 0 });
  }

  // ── 2 · the order of consideration ─────────────────────────────────────────
  const ENERGY_RANK: Record<string, number> = { deep: 0, decide: 1, quick: 2, delegate: 3 };
  const deadlinePressure = (t: Task) => (t.deadline ? t.deadline : "9999-12-31");
  const queue = [...input.tasks].sort((a, b) => {
    const d = deadlinePressure(a).localeCompare(deadlinePressure(b));
    if (d !== 0) return d;
    const f = Number(focus.has(b.initiative_id ?? "")) - Number(focus.has(a.initiative_id ?? ""));
    if (f !== 0) return f;
    const e = (ENERGY_RANK[a.energy ?? "quick"] ?? 2) - (ENERGY_RANK[b.energy ?? "quick"] ?? 2);
    if (e !== 0) return e;
    // batching: keep one project's tasks adjacent in the queue
    return (a.project_id ?? "").localeCompare(b.project_id ?? "") || a.sort_order - b.sort_order;
  });

  // ── 3 · greedy placement inside each energy's natural window ───────────────
  const NOON = 12 * 60 + 30;
  const windowFor = (energy: Energy | null): { from: number; to: number; label: string } => {
    switch (energy) {
      case "deep": return { from: workStartMin, to: Math.min(NOON, workEndMin), label: "morning deep window" };
      case "decide": return { from: Math.min(10 * 60 + 30, workEndMin), to: Math.min(15 * 60, workEndMin), label: "judgment hours" };
      default: return { from: Math.min(13 * 60, workEndMin), to: workEndMin, label: "afternoon batch" };
    }
  };

  const placements: Placement[] = [];
  const unplaced: { task: Task; reason: string }[] = [];
  const lastProjectOn = new Map<string, string | null>(); // dayISO -> project of last placement

  const tryPlace = (t: Task, relaxed: boolean): boolean => {
    const dur = t.duration_minutes ?? 30;
    const win = windowFor(t.energy);
    const dueBefore = t.deadline ?? null;
    for (const day of days) {
      if (dueBefore && day.iso > dueBefore) break; // deadline is a hard boundary
      if (day.placed + dur > day.free * DAY_FILL_CAP && !relaxed) continue;
      if (t.energy === "deep" && day.deepCount >= 2 && !relaxed) continue;
      const from = relaxed ? day.slots[0]?.start ?? win.from : win.from;
      const to = relaxed ? workEndMin : win.to;
      for (const slot of day.slots) {
        const start = snapUp(Math.max(slot.start, from));
        if (start + dur > Math.min(slot.end, to)) continue;
        // place it
        const breather = t.energy === "deep" && dur >= 60 ? BREAK_AFTER_DEEP : 0;
        const consumedEnd = Math.min(slot.end, start + dur + breather);
        // split the slot around the block
        const after: Slot = { start: consumedEnd, end: slot.end };
        const before: Slot = { start: slot.start, end: start };
        day.slots.splice(day.slots.indexOf(slot), 1, ...[before, after].filter((s) => s.end - s.start >= SNAP));
        day.placed += dur;
        if (t.energy === "deep") day.deepCount += 1;

        const batched = lastProjectOn.get(day.iso) != null && lastProjectOn.get(day.iso) === t.project_id;
        lastProjectOn.set(day.iso, t.project_id);
        const reasons = [
          dueBefore ? `due ${dueBefore.slice(5)}` : null,
          focus.has(t.initiative_id ?? "") ? "★ lead bet" : null,
          batched ? "batched with its project" : win.label,
          breather ? `+${BREAK_AFTER_DEEP}m breather after` : null,
        ].filter(Boolean);
        placements.push({ task: t, dayISO: day.iso, startMin: start, durationMin: dur, reason: reasons.join(" · ") });
        return true;
      }
    }
    return false;
  };

  for (const t of queue) {
    if (tryPlace(t, false) || tryPlace(t, true)) continue;
    unplaced.push({
      task: t,
      reason: t.deadline && days.every((d) => d.iso > t.deadline!)
        ? "deadline already behind the remaining week"
        : "the week is full — slack protected",
    });
  }

  placements.sort((a, b) => a.dayISO.localeCompare(b.dayISO) || a.startMin - b.startMin);

  return {
    placements,
    unplaced,
    days: days.map((d) => ({
      dayISO: d.iso,
      label: format(parseDateISO(d.iso), "EEE d"),
      freeMins: d.free,
      placedMins: d.placed,
    })),
  };
}

export const fmtSlot = (p: Placement) => `${fmtMin(p.startMin)}–${fmtMin(p.startMin + p.durationMin)}`;
