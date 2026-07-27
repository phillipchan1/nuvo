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
  /** Set when an overdue task was carved across sittings because no single
   *  block fit. 1-indexed part / total parts. Undefined for whole placements. */
  part?: number;
  parts?: number;
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

/**
 * Work that didn't get a time, and **why** — as a kind, not just a sentence.
 *
 * The two causes are completely different problems and were being reported under
 * one heading ("No room this week"), which read as a flat lie when the calendar
 * plainly had open days: `pace` means the week is inside your calendar but past
 * what history says you finish, and it fires *before* a slot is even looked for.
 * `full` means there is genuinely nowhere to put it.
 */
export type UnplacedKind = "pace" | "full";
export interface UnplacedTask {
  task: Task;
  kind: UnplacedKind;
  reason: string;
}

export interface ComposeResult {
  placements: Placement[];
  unplaced: UnplacedTask[];
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
  /** Weekdays you work (0=Sun…6=Sat). Non-working days hold nothing — the
   *  recurring boundary, where day contexts are the per-week tweak. */
  workingDays?: number[];
  /** Proven weekly pace (from calibration): stop placing past it. */
  weeklyBudgetMins?: number | null;
  /** Ids that must never be carved across sittings. A project slot is a container
   *  holding real tasks — half of it is meaningless, and two placements of one
   *  slot would fight over the same members at commit. */
  atomicIds?: string[];
}

/**
 * Breathing room either side of a meeting — a **preference, not a wall**.
 *
 * It used to be subtracted from busy time, which made it a hard boundary, and on
 * a calendar of back-to-back meetings that quietly deleted the week: a clean
 * 8–10 gap between two meetings measures 120 minutes and became 110, so a two-
 * hour sitting fit *nowhere*, five days running. The plan then reported "the week
 * is full" over a calendar with twenty-eight open hours in it. So the padding is
 * applied first and given up before any work is refused (`tight` below).
 */
const EVENT_BUFFER = 10;
const BREAK_AFTER_DEEP = 15; // breather after a long deep block
const SNAP = 15;

/** Project-backed work never schedules as a throwaway sliver. A capture-time
 *  default or an AI guess of a few minutes for something that *moves a project*
 *  is almost always wrong-low — so we floor it to a real sitting. The plan stays
 *  honest and "significant work" reads like significant work on the grid. */
export const MIN_PROJECT_BLOCK = 45;

/** The minutes we actually plan for a task: its estimate, floored for project
 *  work. Shared by the composer and the pull panel so both tell the same story. */
export function plannedMinutes(durationMins: number | null | undefined, projectBacked: boolean): number {
  const base = durationMins ?? 30;
  return projectBacked ? Math.max(base, MIN_PROJECT_BLOCK) : base;
}

interface Slot {
  start: number;
  end: number;
  /** This edge butts against a meeting (rather than the day's own boundary or
   *  one of your own blocks) — the side that wants breathing room. */
  padStart?: boolean;
  padEnd?: boolean;
}

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
  const working = new Set(input.workingDays ?? [0, 1, 2, 3, 4, 5, 6]);

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
      addBusy(s.day, s.start, end.getHours() * 60 + end.getMinutes());
    } else {
      addBusy(s.day, s.start, 24 * 60);
      addBusy(endDay, 0, end.getHours() * 60 + end.getMinutes());
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
    const date = addDays(monday, i);
    const iso = format(date, "yyyy-MM-dd");
    if (iso < todayISO) continue; // the past is a boundary too
    if (!working.has(date.getDay())) continue; // a non-working day holds nothing
    const context = input.dayContexts?.[iso] ?? "normal";
    if (context === "off") continue; // an off day holds nothing
    let windowStart = workStartMin;
    if (iso === todayISO) windowStart = Math.max(workStartMin, snapUp(nowMin + SNAP));
    if (windowStart >= workEndMin) continue;
    const busy = (busyByDay.get(iso) ?? []).sort((a, b) => a.start - b.start);
    const slots: Slot[] = [];
    let cursor = windowStart;
    let afterEvent = false;
    for (const b of busy) {
      if (b.end <= cursor) continue;
      if (b.start > cursor)
        slots.push({ start: cursor, end: Math.min(b.start, workEndMin), padStart: afterEvent, padEnd: true });
      cursor = Math.max(cursor, b.end);
      afterEvent = true;
      if (cursor >= workEndMin) break;
    }
    if (cursor < workEndMin) slots.push({ start: cursor, end: workEndMin, padStart: afterEvent });
    const free = slots.reduce((s, x) => s + Math.max(0, x.end - x.start), 0);
    if (free >= SNAP)
      days.push({ iso, slots, free, placed: 0, deepCount: 0, context, rules: CONTEXT_RULES[context] });
  }

  // ── 2 · the order of consideration ─────────────────────────────────────────
  //
  // A project's work is ranked **as a project**, then run through in its own
  // order. Ranking each piece independently let a project's second sitting
  // outrank its first (they can carry different deadlines and energies once
  // they're chunked), so the week would ask for step 4 on Monday and step 1 on
  // Friday — an order you cannot actually work in. The group takes its most
  // urgent member's standing, and its members keep `sort_order` inside it.
  const ENERGY_RANK: Record<string, number> = { deep: 0, decide: 1, quick: 2, delegate: 3 };
  const deadlinePressure = (t: Task) => (t.deadline ? t.deadline : "9999-12-31");
  const rankOf = (t: Task) => ENERGY_RANK[t.energy ?? "quick"] ?? 2;
  /** Loose work is its own group; project work shares one. */
  const groupKey = (t: Task) => (t.project_id ? `p:${t.project_id}` : `t:${t.id}`);

  const groups = new Map<string, { deadline: string; focus: boolean; rank: number; project: boolean }>();
  for (const t of input.tasks) {
    const k = groupKey(t);
    const cur = groups.get(k);
    const next = {
      deadline: deadlinePressure(t),
      focus: focus.has(t.initiative_id ?? ""),
      rank: rankOf(t),
      project: Boolean(t.project_id),
    };
    groups.set(
      k,
      cur
        ? {
            deadline: cur.deadline < next.deadline ? cur.deadline : next.deadline,
            focus: cur.focus || next.focus,
            rank: Math.min(cur.rank, next.rank),
            project: cur.project || next.project,
          }
        : next,
    );
  }

  const queue = [...input.tasks].sort((a, b) => {
    const ka = groupKey(a);
    const kb = groupKey(b);
    if (ka === kb) return a.sort_order - b.sort_order; // inside a project: its own order, always
    const ga = groups.get(ka)!;
    const gb = groups.get(kb)!;
    const d = ga.deadline.localeCompare(gb.deadline);
    if (d !== 0) return d;
    // owed work first (deadlines, above), then the week's INTENT, then the rest:
    // project-backed work outranks loose captures for the open slots, so a week
    // can't fill up with errands while the projects you named go unplaced.
    const p = Number(gb.project) - Number(ga.project);
    if (p !== 0) return p;
    const f = Number(gb.focus) - Number(ga.focus);
    if (f !== 0) return f;
    const e = ga.rank - gb.rank;
    if (e !== 0) return e;
    return ka.localeCompare(kb);
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
  const unplaced: UnplacedTask[] = [];
  const lastProjectOn = new Map<string, string | null>(); // dayISO -> project of last placement
  /**
   * The earliest a project's *next* piece may start — `dayISO` plus the minute
   * its previous piece ended.
   *
   * Ordering the queue isn't enough on its own. Placement is greedy per piece, so
   * a project's part 1 (two tasks, a longer block) can fall through Mon–Thu
   * looking for a contiguous slot and land Friday, while its smaller part 2 takes
   * Monday — leaving the week asking for step 4 before step 1, which is an order
   * you cannot work in. A project's own work is therefore a **chain**: each piece
   * must start at or after the end of the piece before it.
   */
  const projectAfter = new Map<string, { dayISO: string; endMin: number }>();

  const tryPlace = (t: Task, relaxed: boolean, tight = false): boolean => {
    const dur = plannedMinutes(t.duration_minutes, !!t.project_id);
    const win = windowFor(t.energy);
    const dueBefore = t.deadline ?? null;
    // An already-passed deadline isn't a ceiling — it's a "do this first" flag.
    // Overdue work is the most urgent thing you have; schedule it ASAP (the queue
    // already sorts earliest-deadline first, so it lands in the first open slot)
    // instead of stranding it in the pool forever.
    const overdue = dueBefore != null && dueBefore < todayISO;
    const shallow = t.energy === "quick" || t.energy === "delegate" || t.energy == null;
    // a project's earlier pieces pin the floor for its later ones
    const after = t.project_id ? projectAfter.get(t.project_id) : undefined;
    for (const day of days) {
      if (after && day.iso < after.dayISO) continue; // its predecessor is later in the week
      if (dueBefore && !overdue && day.iso > dueBefore) break; // a live deadline is a hard boundary
      // context rules are boundaries — hard in both passes
      if (day.rules.shallowOnly && !shallow) continue;
      if (t.energy === "deep" && day.deepCount >= day.rules.maxDeep) continue;
      // the fill cap is soft on normal days (relaxed pass may exceed it),
      // hard wherever a context deliberately keeps the day small
      const capHard = day.context !== "normal";
      if (day.placed + dur > day.free * day.rules.cap && (!relaxed || capHard)) continue;
      let from = relaxed ? day.slots[0]?.start ?? win.from : win.from;
      const to = relaxed ? workEndMin : win.to;
      // same day as the previous piece? then it starts after it, not beside it
      if (after && day.iso === after.dayISO) from = Math.max(from, after.endMin);
      for (const slot of day.slots) {
        // the breathing room either side of a meeting — kept while there's room
        // for it, given up in the `tight` pass rather than refusing the work
        const pad = tight ? 0 : EVENT_BUFFER;
        const usableStart = slot.start + (slot.padStart ? pad : 0);
        const usableEnd = slot.end - (slot.padEnd ? pad : 0);
        const start = snapUp(Math.max(usableStart, from));
        if (start + dur > Math.min(usableEnd, to)) continue;
        // place it
        const breather = t.energy === "deep" && dur >= 60 ? BREAK_AFTER_DEEP : 0;
        const consumedEnd = Math.min(slot.end, start + dur + breather);
        // Split the slot around the block. Your own work may sit flush against
        // your own work — only a meeting earns padding — so the new edges either
        // side of it are unpadded.
        const after: Slot = { start: consumedEnd, end: slot.end, padEnd: slot.padEnd };
        const before: Slot = { start: slot.start, end: start, padStart: slot.padStart };
        day.slots.splice(day.slots.indexOf(slot), 1, ...[before, after].filter((s) => s.end - s.start >= SNAP));
        day.placed += dur;
        if (t.energy === "deep") day.deepCount += 1;

        const batched = lastProjectOn.get(day.iso) != null && lastProjectOn.get(day.iso) === t.project_id;
        lastProjectOn.set(day.iso, t.project_id);
        if (t.project_id) projectAfter.set(t.project_id, { dayISO: day.iso, endMin: start + dur });
        const reasons = [
          overdue ? "overdue — scheduled first" : dueBefore ? `due ${dueBefore.slice(5)}` : null,
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

  // Overdue work that won't fit as one block is carved across sittings. We ignore
  // energy windows and the fill cap here — an overdue commitment outranks the
  // week's shape, and the alternative is it never getting scheduled at all. Each
  // piece is a real, separately-schedulable block (the commit materializes parts
  // 2+ as their own rows, since a task row can only hold one time block).
  const SPLIT_MIN_CHUNK = 30;
  const MAX_SPLIT = 3;
  const trySplit = (t: Task, total: number): Placement[] | null => {
    if (total < SPLIT_MIN_CHUNK * 2) return null; // too small to be worth splitting
    // open spans in day/time order — trySplit only runs after whole placement
    // failed, so every span is smaller than `total` (guaranteeing ≥2 pieces)
    const spans: { day: (typeof days)[number]; start: number; end: number }[] = [];
    for (const day of days) {
      if (day.rules.cap === 0) continue;
      for (const slot of day.slots) {
        const start = snapUp(slot.start);
        const end = Math.min(slot.end, workEndMin);
        if (end - start >= SPLIT_MIN_CHUNK) spans.push({ day, start, end });
      }
    }
    let remaining = total;
    const chosen: { day: (typeof days)[number]; start: number; dur: number }[] = [];
    for (const span of spans) {
      if (remaining <= 0 || chosen.length >= MAX_SPLIT) break;
      let take = Math.floor(Math.min(span.end - span.start, remaining) / SNAP) * SNAP;
      if (take < SPLIT_MIN_CHUNK) continue;
      chosen.push({ day: span.day, start: span.start, dur: take });
      remaining -= take;
    }
    if (remaining > 0) return null; // couldn't fit even split within MAX_SPLIT pieces

    const parts = chosen.length;
    return chosen.map((c, i) => {
      const s = c.start;
      const e = s + c.dur;
      const slot = c.day.slots.find((sl) => sl.start <= s && sl.end >= e);
      if (slot) {
        const before: Slot = { start: slot.start, end: s };
        const after: Slot = { start: e, end: slot.end };
        c.day.slots.splice(c.day.slots.indexOf(slot), 1, ...[before, after].filter((x) => x.end - x.start >= SNAP));
      }
      c.day.placed += c.dur;
      return {
        task: t,
        dayISO: c.day.iso,
        startMin: s,
        durationMin: c.dur,
        reason: `overdue — split ${i + 1}/${parts}`,
        part: i + 1,
        parts,
      };
    });
  };

  const atomic = new Set(input.atomicIds ?? []);
  const budget = input.weeklyBudgetMins ?? null;
  let placedTotal = 0;

  /** The longest unbroken stretch still open anywhere in the week — the number
   *  that decides whether "no room" is about volume or about shape. */
  const longestGap = () => Math.max(0, ...days.flatMap((d) => d.slots.map((s) => s.end - s.start)));
  /** Every open minute still left, so a refusal can never claim the week is full
   *  while hours of it sit there. */
  const openLeft = () => days.reduce((n, d) => n + d.slots.reduce((m, s) => m + (s.end - s.start), 0), 0);
  const asHours = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);

  /**
   * How hard we're willing to look. `natural` is the full ladder — the energy's
   * own window, then anywhere in the day, then flush against a meeting.
   * `anywhere` and `flush` skip straight down it, and exist for the second
   * seating of a project that got stranded: the ladder is *per piece*, so a
   * project's part 1 will keep winning the same comfortable late slot on every
   * retry and stranding part 2 behind it. Starting lower down moves it.
   */
  type Reach = "natural" | "anywhere" | "flush";

  /**
   * One piece, through the ladder — and (for overdue work) carved across
   * sittings as a last resort.
   *
   * It **returns** the refusal instead of pushing it, because a project is placed
   * as a set: a group that loses a piece is rolled back and re-seated, and a
   * refusal recorded on the way would survive the rollback as a ghost.
   */
  const placeTask = (t: Task, reach: Reach): UnplacedTask | null => {
    const dur = plannedMinutes(t.duration_minutes, !!t.project_id);
    // the proven-pace boundary: don't plan past what history says gets done
    if (budget != null && placedTotal + dur > budget) {
      return {
        task: t,
        kind: "pace",
        reason: `past the ~${Math.round(budget / 60)}h/wk you've actually been finishing`,
      };
    }
    // Padded first, anywhere in the week — and only then flush against a meeting.
    // Breathing room is worth reordering the week for; it is not worth dropping
    // work over, which is what a hard buffer had been quietly doing.
    const found =
      (reach === "natural" && tryPlace(t, false)) ||
      (reach !== "flush" && tryPlace(t, true)) ||
      tryPlace(t, true, true);
    if (found) {
      placedTotal += dur;
      return null;
    }
    const isOverdue = t.deadline != null && t.deadline < todayISO;
    // last resort for overdue work: carve it across sittings so it still lands
    if (isOverdue && !atomic.has(t.id)) {
      const pieces = trySplit(t, dur);
      if (pieces) {
        placements.push(...pieces);
        placedTotal += dur;
        return null;
      }
    }
    const deepBlocked =
      t.energy === "deep" && days.every((d) => d.rules.maxDeep === 0 || d.deepCount >= d.rules.maxDeep);
    // A project's later piece may only start after its earlier one — so when it
    // fails, the honest answer names that piece, not the week.
    const after = t.project_id ? projectAfter.get(t.project_id) : undefined;
    const chained =
      after != null &&
      days.every(
        (d) =>
          d.iso < after.dayISO ||
          d.slots.every((s) => Math.max(s.start, d.iso === after.dayISO ? after.endMin : 0) + dur > s.end),
      );
    return {
      task: t,
      kind: "full",
      reason: isOverdue
        ? "overdue — no open time left this week"
        : t.deadline && days.every((d) => d.iso > t.deadline!)
          ? "deadline already behind the remaining week"
          : deepBlocked
            ? "no deep-capable day left (contexts/limits)"
            : chained
              ? `nothing left after its earlier part (${format(parseDateISO(after!.dayISO), "EEE")} ${fmtMin(after!.endMin)})`
              : // "the week is full" was a flat lie whenever the room was there but
                // in the wrong shape — the complaint every time was "look how much
                // free space is on the calendar". Say which of the two it is.
                `needs ${asHours(dur)} unbroken — longest gap left is ${asHours(longestGap())} (${asHours(openLeft())} open in total)`,
    };
  };

  // ── 4 · a project is seated as a set, not a piece at a time ────────────────
  //
  // Its pieces run in order (`projectAfter`), and placement is greedy, so part 1
  // would take the last afternoon of the week and put every later part off the
  // end — reported as "the week is full" with twenty morning hours untouched.
  // So a project that loses a piece gives the whole thing back and is seated
  // again from the top of the week, where its parts can run consecutively.
  const projectRuns: Task[][] = [];
  for (const t of queue) {
    const last = projectRuns[projectRuns.length - 1];
    if (last && t.project_id && last[0].project_id === t.project_id) last.push(t);
    else projectRuns.push([t]);
  }

  type Snapshot = ReturnType<typeof snapshot>;
  const snapshot = () => ({
    days: days.map((d) => ({ d, slots: d.slots.map((s) => ({ ...s })), placed: d.placed, deepCount: d.deepCount })),
    placements: placements.length,
    lastProjectOn: new Map(lastProjectOn),
    projectAfter: new Map(projectAfter),
    placedTotal,
  });
  const restore = (s: Snapshot) => {
    for (const e of s.days) {
      e.d.slots = e.slots.map((x) => ({ ...x }));
      e.d.placed = e.placed;
      e.d.deepCount = e.deepCount;
    }
    placements.length = s.placements;
    lastProjectOn.clear();
    for (const [k, v] of s.lastProjectOn) lastProjectOn.set(k, v);
    projectAfter.clear();
    for (const [k, v] of s.projectAfter) projectAfter.set(k, v);
    placedTotal = s.placedTotal;
  };

  for (const group of projectRuns) {
    const attempt = (reach: Reach) => {
      const misses: UnplacedTask[] = [];
      for (const t of group) {
        const miss = placeTask(t, reach);
        if (miss) misses.push(miss);
      }
      return misses;
    };
    const before = snapshot();
    let misses = attempt("natural");
    // Only a multi-part project can be stranded by its own chain, and only a
    // "full" refusal is worth re-seating — a pace refusal would repeat.
    if (misses.length > 0 && group.length > 1 && group[0].project_id && misses.every((m) => m.kind === "full")) {
      let best: Snapshot | null = null;
      for (const reach of ["anywhere", "flush"] as const) {
        restore(before);
        const retry = attempt(reach);
        if (retry.length < misses.length) {
          misses = retry;
          best = snapshot();
          if (retry.length === 0) break;
        }
      }
      // nothing did better — put the first seating back, exactly as it was
      if (best) restore(best);
      else {
        restore(before);
        misses = attempt("natural");
      }
    }
    unplaced.push(...misses);
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
