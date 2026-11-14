// The marks — readiness from the day to the season (D-209, docs/readiness-ladder.md).
//
// Every planner altitude reads through the same three MARKS, in the same order:
// shaped → given time → the run. Each mark is a bar of pieces, one piece per
// real thing (a project, a task, a bet). Your act fills a piece. When an
// altitude's first two marks close, its title earns the ember stop; the third
// mark is the run and never holds the stop back. The DAY sits above them all:
// today's own tasks, closed the moment the last one is done.
//
// The rules (what counts toward the day, which bets are moving, when a week
// fits) live in the planning kernel, so the agent reads the same answers. This
// file only shapes them for drawing. (Not `readiness.ts`: that is the older
// floor-settledness model the Spine reads, docs/readiness-model.md.)

import {
  dayReadiness,
  fitsCapacity,
  movingInitiativeIds,
  type DayReadiness,
} from "../../supabase/functions/_shared/planningRules.ts";
import type { Task } from "./types";
import { todayISO } from "./dates";
import type { VerticalData } from "./vertical";
import { projectReadinessAxes } from "./lenses";
import type { WeekCrown } from "../hooks/useWeekCrown";

/** How loud a mark is when it closes — the reward grows with what it means. */
export type MarkTier = "small" | "medium" | "large";

/** fill = done/true · soft = placed, a promise not a result · other = done,
 *  not significant · empty = not yet. */
export type PieceState = "fill" | "soft" | "other" | "empty";
export interface MarkPiece {
  state: PieceState;
  color: string;
}

export type MarkKey =
  | "day"
  | "week"
  | "ready"
  | "placed"
  | "done"
  | "deck-ready"
  | "fits"
  | "shipped"
  | "bet-ready"
  | "on-week"
  | "moving";

export interface Mark {
  key: MarkKey;
  label: string;
  n: number;
  of: number;
  full: boolean;
  tier: MarkTier;
  pieces: MarkPiece[];
  /** the line under the mark, when it has one (Done's significance) */
  detail?: string;
}

/** What a mark counts, and when it closes — the quiet definition each label
 *  carries (hover, focus or a tap). One place, so the words can't drift. */
export const MARK_DEFS: Record<MarkKey, { name: string; counts: string; closes: string }> = {
  day: {
    name: "Today",
    counts: "Your tasks dated today. A repeating task that rolled in from an earlier day doesn't count.",
    closes: "Finish them all and the day is done, at whatever hour that is. Each one also fills Done on the week.",
  },
  week: {
    name: "This week",
    counts: "The projects you committed to this week, and their tasks.",
    closes: "Its stop lands when every project is Ready and every task is Placed.",
  },
  ready: {
    name: "Ready",
    counts: "Projects on this week with an outcome, a finish date and open steps.",
    closes: "Closes when every project on the week is shaped.",
  },
  placed: {
    name: "Placed",
    counts: "Tasks on this week that have a time on your calendar. A time is the only promise.",
    closes: "Closes when nothing on the week is waiting for a time.",
  },
  done: {
    name: "Done",
    counts: "Tasks on this week you've finished. In color when they serve an initiative whose number moved this quarter.",
    closes: "The run: it fills all week and never holds the stop back.",
  },
  "deck-ready": {
    name: "Ready",
    counts: "Projects on the deck with an outcome, a finish date and open steps.",
    closes: "Closes when every project on the deck is shaped.",
  },
  fits: {
    name: "Fits",
    counts: "This week's project hours against your capacity.",
    closes: "Closes inside 70–100% of capacity. Past it, the overflow hatches.",
  },
  shipped: {
    name: "Shipped",
    counts: "Projects on the deck you've shipped.",
    closes: "The run: it never holds the stop back.",
  },
  "bet-ready": {
    name: "Ready",
    counts: "Initiatives with an outcome, a finish date and a number to move.",
    closes: "Closes when every bet is clear.",
  },
  "on-week": {
    name: "On a week",
    counts: "Initiatives with at least one project on this week.",
    closes: "Closes when every bet is being worked this week.",
  },
  moving: {
    name: "Moving",
    counts: "Initiatives whose number moved this quarter.",
    closes: "Moves only when you record a new number. The run: it never holds the stop back.",
  },
};

export function markTitle(key: MarkKey): string {
  const d = MARK_DEFS[key];
  return `${d.name}. ${d.counts} ${d.closes}`;
}

const TIER: Record<MarkKey, MarkTier> = {
  day: "large",
  week: "large",
  ready: "small",
  placed: "medium",
  done: "medium",
  "deck-ready": "small",
  fits: "medium",
  shipped: "large",
  "bet-ready": "small",
  "on-week": "medium",
  moving: "large",
};

function mark(key: MarkKey, label: string, pieces: MarkPiece[], n: number, of: number, detail?: string): Mark {
  return { key, label, n, of, full: of > 0 && n >= of, tier: TIER[key], pieces, detail };
}

// ── significance: only toward a moving bet ───────────────────────────────────

/** The initiatives whose number moved this quarter (the kernel's rule). */
export function movingIds(d: Pick<VerticalData, "initiatives">, now: Date): string[] {
  return movingInitiativeIds(
    d.initiatives.map((i) => ({
      id: i.id,
      keyResults: i.keyResults.map((kr) => ({ baseline: kr.baseline, current: kr.current, updatedAt: kr.updatedAt })),
    })),
    todayISO(now),
  );
}

// ── the day ──────────────────────────────────────────────────────────────────

export interface DayRead extends DayReadiness {
  /** the closing moment, as a Date (null until closed) */
  closedAtDate: Date | null;
  /** minutes of the working day still ahead when it closed — "of your day back" */
  backMins: number | null;
  /** today's own tasks, earliest first (timed by start, then untimed) */
  tasks: Task[];
}

const ownToday = (t: Task) =>
  t.status !== "trashed" && (t.status === "done" || !(t.recurrence_id != null && (t.roll_count ?? 0) > 0));

/** Timed first, by the clock; untimed after (code-point order — a locale
 *  collation would sort a sentinel ahead of the digits). */
const byClock = (a: string | null, b: string | null) =>
  a === b ? 0 : a == null ? 1 : b == null ? -1 : new Date(a).getTime() - new Date(b).getTime();

/** Today's read from the tasks the rail already lists for today (slot children
 *  included). `workEndMins` is the user's working-day end (Settings). */
export function readDay(today: readonly Task[], workEndMins: number): DayRead {
  const r = dayReadiness(
    today.map((t) => ({
      id: t.id,
      status: t.status,
      completedAt: t.completed_at,
      rollCount: t.roll_count ?? 0,
      recurrenceId: t.recurrence_id ?? null,
    })),
  );
  const tasks = today
    .filter(ownToday)
    .sort((a, b) => byClock(a.start_time, b.start_time) || a.sort_order - b.sort_order);
  const closedAtDate = r.closedAt ? new Date(r.closedAt) : null;
  let backMins: number | null = null;
  if (closedAtDate) {
    const at = closedAtDate.getHours() * 60 + closedAtDate.getMinutes();
    backMins = workEndMins - at > 0 ? workEndMins - at : null;
  }
  return { ...r, closedAtDate, backMins, tasks };
}

/** The day's bar: one piece per task, in its project's hue when it has one. */
export function dayPieces(day: DayRead, colorOf: (t: Task) => string): MarkPiece[] {
  return day.tasks.map((t) => ({ state: t.status === "done" ? "fill" : "empty", color: colorOf(t) }));
}

/** "1h 56m" — the day's reward, said the way a person would. */
export function spanWords(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ── the week ─────────────────────────────────────────────────────────────────

/** The week's three marks over the crown's rows. Pieces group by project so a
 *  project reads as one run of its own hue on every bar. */
export function weekMarks(crown: WeekCrown, d: VerticalData, now: Date, moving: readonly string[]): Mark[] {
  const movingSet = new Set(moving);
  const readyPieces: MarkPiece[] = [];
  const placedPieces: MarkPiece[] = [];
  const donePieces: MarkPiece[] = [];
  let ready = 0;
  let sigDone = 0;
  let otherDone = 0;
  for (const r of crown.rows) {
    const p = d.projects.find((x) => x.id === r.projectId);
    const axes = p ? projectReadinessAxes(d, p, now) : null;
    const landed = r.state === "shipped" || r.state === "landed";
    const isReady = landed || (axes != null && axes.defined && axes.planned);
    if (isReady) ready++;
    readyPieces.push({ state: isReady ? "fill" : "empty", color: r.color });
    const significant = p?.initiativeId != null && movingSet.has(p.initiativeId);
    const done = r.work.done;
    const placed = r.placed.length;
    const loose = r.loose.length;
    for (let i = 0; i < done + placed; i++) placedPieces.push({ state: "soft", color: r.color });
    for (let i = 0; i < loose; i++) placedPieces.push({ state: "empty", color: r.color });
    for (let i = 0; i < done; i++) donePieces.push({ state: significant ? "fill" : "other", color: r.color });
    for (let i = 0; i < placed + loose; i++) donePieces.push({ state: "empty", color: r.color });
    if (significant) sigDone += done;
    else otherDone += done;
  }
  const total = placedPieces.length;
  const placedN = placedPieces.filter((x) => x.state !== "empty").length;
  const doneN = donePieces.filter((x) => x.state !== "empty").length;
  // An account with no initiatives is never scored against a ladder it hasn't
  // built (P7, P16): no significance line at all.
  const detail =
    d.initiatives.length === 0
      ? undefined
      : moving.length > 0
        ? `${sigDone} toward a moving initiative · ${otherDone} other`
        : "No initiative's number has moved this quarter";
  return [
    mark("ready", "Ready", readyPieces, ready, crown.rows.length),
    mark("placed", "Placed", placedPieces, placedN, total),
    mark("done", "Done", donePieces, doneN, total, detail),
  ];
}

/** An altitude's stop: its first two marks closed (the third is the run). */
export function marksReady(marks: readonly Mark[]): boolean {
  return marks.length >= 2 && marks[0].full && marks[1].full;
}

// ── the decks ────────────────────────────────────────────────────────────────

export interface DeckProjectFact {
  id: string;
  color: string;
  ready: boolean;
  shipped: boolean;
  /** this week's planned minutes for it (0 when it isn't on this week) */
  weekMins: number;
}

const hours = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;

/** The project deck's marks: Ready · Fits · Shipped. */
export function projectDeckMarks(projects: readonly DeckProjectFact[], capacityMins: number): Mark[] {
  const demand = projects.filter((p) => !p.shipped).reduce((n, p) => n + p.weekMins, 0);
  const fit = fitsCapacity(demand, capacityMins);
  const fits: Mark = {
    key: "fits",
    label: "Fits",
    n: Math.round(demand / 60),
    of: Math.round(capacityMins / 60),
    full: fit === "fits",
    tier: TIER.fits,
    pieces: projects.filter((p) => !p.shipped && p.weekMins > 0).map((p) => ({ state: "soft", color: p.color })),
    detail:
      capacityMins <= 0
        ? undefined
        : fit === "over"
          ? `${hours(demand)} of ${hours(capacityMins)} · ${hours(demand - capacityMins)} over`
          : fit === "under"
            ? `${hours(demand)} of ${hours(capacityMins)} · room for more`
            : `${hours(demand)} of ${hours(capacityMins)}`,
  };
  const readyN = projects.filter((p) => p.ready || p.shipped).length;
  return [
    mark("deck-ready", "Ready", projects.map((p) => ({ state: p.ready || p.shipped ? "fill" : "empty", color: p.color })), readyN, projects.length),
    fits,
    mark("shipped", "Shipped", projects.map((p) => ({ state: p.shipped ? "fill" : "empty", color: p.color })), projects.filter((p) => p.shipped).length, projects.length),
  ];
}

/** Where the Fits bar draws: demand against capacity, as fractions of a scale
 *  wide enough for both (and a little air), plus the 70–100% band. */
export function fitsGeometry(demandMins: number, capacityMins: number) {
  const scale = Math.max(demandMins, capacityMins, 1) * 1.12;
  return {
    demand: demandMins / scale,
    bandFrom: (capacityMins * 0.7) / scale,
    bandTo: capacityMins / scale,
  };
}

export interface DeckBetFact {
  id: string;
  color: string;
  ready: boolean;
  onWeek: boolean;
  moving: boolean;
}

/** The initiative deck's marks: Ready · On a week · Moving. */
export function initiativeDeckMarks(bets: readonly DeckBetFact[]): Mark[] {
  const pieces = (f: (b: DeckBetFact) => boolean, soft = false): MarkPiece[] =>
    bets.map((b) => ({ state: f(b) ? (soft ? "soft" : "fill") : "empty", color: b.color }));
  return [
    mark("bet-ready", "Ready", pieces((b) => b.ready), bets.filter((b) => b.ready).length, bets.length),
    mark("on-week", "On a week", pieces((b) => b.onWeek, true), bets.filter((b) => b.onWeek).length, bets.length),
    mark("moving", "Moving", pieces((b) => b.moving), bets.filter((b) => b.moving).length, bets.length),
  ];
}
