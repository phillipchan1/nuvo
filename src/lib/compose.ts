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

/** Per-day boundary: where you are shapes what the day can hold. */
export type DayContext = "normal" | "light" | "travel" | "off";

const CONTEXT_RULES: Record<DayContext, { cap: number; maxDeep: number; shallowOnly: boolean; note: string | null }> = {
  normal: { cap: 0.75, maxDeep: 2, shallowOnly: false, note: null },
  light: { cap: 0.4, maxDeep: 1, shallowOnly: false, note: "light day" },
  travel: { cap: 0.4, maxDeep: 0, shallowOnly: true, note: "travel day — shallow only" },
  off: { cap: 0, maxDeep: 0, shallowOnly: true, note: "off" },
};

export const CONTEXT_META: Record<DayContext, { glyph: string; label: string }> = {
  normal: { glyph: "·", label: "normal" },
  light: { glyph: "◐", label: "light" },
  travel: { glyph: "✈", label: "travel" },
  off: { glyph: "—", label: "off" },
};

export interface ComposeDay {
  dayISO: string;
  label: string; // "Mon 16"
  context: DayContext;
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
  /** dayISO -> context; missing days are "normal". */
  dayContexts?: Record<string, DayContext>;
  /** Proven weekly pace (from calibration): stop placing past it. */
  weeklyBudgetMins?: number | null;
}

const EVENT_BUFFER = 10; // minutes around immovable events
const BREAK_AFTER_DEEP = 15; // breather after a long deep block
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
  const days: {
    iso: string; slots: Slot[]; free: number; placed: number; deepCount: number;
    context: DayContext; rules: (typeof CONTEXT_RULES)[DayContext];
  }[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = format(addDays(monday, i), "yyyy-MM-dd");
    if (iso < todayISO) continue; // the past is a boundary too
    const context = input.dayContexts?.[iso] ?? "normal";
    if (context === "off") continue; // an off day holds nothing
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
    if (free >= SNAP)
      days.push({ iso, slots, free, placed: 0, deepCount: 0, context, rules: CONTEXT_RULES[context] });
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
    const shallow = t.energy === "quick" || t.energy === "delegate" || t.energy == null;
    for (const day of days) {
      if (dueBefore && day.iso > dueBefore) break; // deadline is a hard boundary
      // context rules are boundaries — hard in both passes
      if (day.rules.shallowOnly && !shallow) continue;
      if (t.energy === "deep" && day.deepCount >= day.rules.maxDeep) continue;
      // the fill cap is soft on normal days (relaxed pass may exceed it),
      // hard wherever a context deliberately keeps the day small
      const capHard = day.context !== "normal";
      if (day.placed + dur > day.free * day.rules.cap && (!relaxed || capHard)) continue;
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
          day.rules.note,
          breather ? `+${BREAK_AFTER_DEEP}m breather after` : null,
        ].filter(Boolean);
        placements.push({ task: t, dayISO: day.iso, startMin: start, durationMin: dur, reason: reasons.join(" · ") });
        return true;
      }
    }
    return false;
  };

  const budget = input.weeklyBudgetMins ?? null;
  let placedTotal = 0;
  for (const t of queue) {
    const dur = t.duration_minutes ?? 30;
    // the proven-pace boundary: don't plan past what history says gets done
    if (budget != null && placedTotal + dur > budget) {
      unplaced.push({ task: t, reason: `past your proven pace (~${Math.round(budget / 60)}h/wk) — protect the win rate` });
      continue;
    }
    if (tryPlace(t, false) || tryPlace(t, true)) {
      placedTotal += dur;
      continue;
    }
    const deepBlocked =
      t.energy === "deep" && days.every((d) => d.rules.maxDeep === 0 || d.deepCount >= d.rules.maxDeep);
    unplaced.push({
      task: t,
      reason: t.deadline && days.every((d) => d.iso > t.deadline!)
        ? "deadline already behind the remaining week"
        : deepBlocked
          ? "no deep-capable day left (contexts/limits)"
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
      context: d.context,
      freeMins: d.free,
      placedMins: d.placed,
    })),
  };
}

export const fmtSlot = (p: Placement) => `${fmtMin(p.startMin)}–${fmtMin(p.startMin + p.durationMin)}`;
