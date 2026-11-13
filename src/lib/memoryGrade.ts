// How Nuvo grades its own guesses (docs/memory.md §13.4, D-197).
//
// Every proposal is a prediction, graded against what you did with it. The log
// is `user_settings.memory.graded` — a ring buffer, not a table (D-197 says why)
// — and these are the pure rules that write and read it. No React, no I/O, so
// the counts on the Memory page are tested, not eyeballed.
//
// The outcomes grade Nuvo, never you (N-04): they are counts in the evidence
// voice ("14 of 20"), never a percentage, a streak or a score.

import { dayMs, isoOf, mondayOf } from "../../supabase/functions/_shared/planningRules";

/** Where the guess was made. */
export type GradeSurface = "path" | "question";
/** What you did with it. `ignored` = shown, never answered. */
export type GradeOutcome = "kept" | "edited" | "dropped" | "ignored";

export interface Graded {
  /** ISO timestamp. */
  at: string;
  s: GradeSurface;
  o: GradeOutcome;
  /** What was proposed, short — so a count can say what it counted. */
  t?: string;
  /** Memory keys that shaped the proposal. */
  m?: string[];
}

export type GradeIn = Omit<Graded, "at"> & { at?: string };

/** The ring's size: enough for two windows on every surface, small enough for one row. */
export const GRADED_MAX = 200;
/** How many resolved guesses a count is taken over. */
export const GRADE_WINDOW = 20;

const short = (t: string | undefined) => (t ? (t.length > 60 ? `${t.slice(0, 59)}…` : t) : undefined);

/** Append outcomes to the ring, oldest out first. */
export function appendGraded(list: readonly Graded[] | undefined, add: readonly GradeIn[], now = new Date()): Graded[] {
  const stamped = add.map((g) => ({ ...g, at: g.at ?? now.toISOString(), t: short(g.t) }));
  return [...(list ?? []), ...stamped].slice(-GRADED_MAX);
}

/** A drafted step, kept: as Nuvo drafted it, or after you changed it. Choosing
 *  another version, renaming it or resizing it is an edit. */
export function gradeKept(
  origin: { title: string; durationMins: number | null },
  kept: { title: string; durationMins: number | null },
  version: number,
): "kept" | "edited" {
  const same = version === 0 && origin.title.trim() === kept.title.trim() && (origin.durationMins ?? null) === (kept.durationMins ?? null);
  return same ? "kept" : "edited";
}

export type KeptAsDrafted =
  | { gated: true; soFar: number; need: number }
  | { gated: false; kept: number; of: number; before: { kept: number; of: number } | null };

/**
 * Kept as drafted: of the last 20 resolved guesses on a surface, how many you
 * kept exactly as drafted. Ignored ones aren't resolved, so they don't count
 * either way. The 20 before that is the comparison, once there are 20 of them.
 */
export function keptAsDrafted(graded: readonly Graded[] | undefined, surface: GradeSurface = "path"): KeptAsDrafted {
  const resolved = (graded ?? []).filter((g) => g.s === surface && g.o !== "ignored");
  if (resolved.length < GRADE_WINDOW) return { gated: true, soFar: resolved.length, need: GRADE_WINDOW };
  const last = resolved.slice(-GRADE_WINDOW);
  const prior = resolved.slice(-2 * GRADE_WINDOW, -GRADE_WINDOW);
  const count = (xs: Graded[]) => xs.filter((g) => g.o === "kept").length;
  return {
    gated: false,
    kept: count(last),
    of: GRADE_WINDOW,
    before: prior.length === GRADE_WINDOW ? { kept: count(prior), of: GRADE_WINDOW } : null,
  };
}

/** A span of a weekday, in minutes after midnight. Monday = 0. */
export interface WeekBlock {
  weekday: number;
  startMin: number;
  endMin: number;
}

/**
 * Would have drawn it: of the minutes you actually spent in events last week,
 * how many fell inside the week Nuvo would have drawn. Overlapping predictions
 * are counted once.
 */
export function drawnMinutes(actual: readonly WeekBlock[], predicted: readonly WeekBlock[]): { hit: number; total: number } {
  let hit = 0;
  let total = 0;
  for (const a of actual) {
    if (a.endMin <= a.startMin) continue;
    total += a.endMin - a.startMin;
    const segs = predicted
      .filter((p) => p.weekday === a.weekday)
      .map((p) => [Math.max(a.startMin, p.startMin), Math.min(a.endMin, p.endMin)] as const)
      .filter(([s, e]) => e > s)
      .sort((x, y) => x[0] - y[0]);
    let cur = a.startMin;
    for (const [s, e] of segs) {
      const from = Math.max(s, cur);
      if (e > from) {
        hit += e - from;
        cur = e;
      }
    }
  }
  return { hit, total };
}

/** Did the prediction draw at least half of this block? (How a lived block is marked.) */
export function drawnAhead(a: WeekBlock, predicted: readonly WeekBlock[]): boolean {
  return drawnMinutes([a], predicted).hit * 2 >= a.endMin - a.startMin;
}

/** Last week, Monday to Sunday, as local dates. */
export function lastWeekOf(today: string): { start: string; end: string } {
  const start = dayMs(mondayOf(today)) - 7 * 86_400_000;
  return { start: isoOf(start), end: isoOf(start + 6 * 86_400_000) };
}

/** An ISO timestamp's local calendar day. */
export function localDayOf(isoTs: string): string {
  const d = new Date(isoTs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Hours, said plainly: "31", "31½". */
export function hoursSaid(minutes: number): string {
  const h = minutes / 60;
  const whole = Math.floor(h);
  return h - whole >= 0.5 ? `${whole}½` : `${whole}`;
}

/**
 * The weekly question budget (§13.2): one or two a week at most. Answers given
 * this week spend it; the rest wait for next week.
 */
export const QUESTIONS_PER_WEEK = 2;
export function questionsLeft(graded: readonly Graded[] | undefined, today: string): number {
  const monday = mondayOf(today);
  const asked = (graded ?? []).filter((g) => g.s === "question" && g.o !== "ignored" && localDayOf(g.at) >= monday).length;
  return Math.max(0, QUESTIONS_PER_WEEK - asked);
}
