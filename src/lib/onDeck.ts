// On Deck — grooming's higher-level start. Arranges the in-flight projects across
// the next few weeks as a demand-phased timeline: which project lands in which
// week, whether a week is about to overflow (the pinch), and how many weeks of
// *ready* work are stocked against a typical week's capacity. Pure over a
// VerticalData snapshot + the calendar-derived capacity read, exactly like
// readiness.ts / standing.ts — NO new scoring, only an arrangement of what the
// pace / capacity / tending engines already return. See docs/on-deck.md.

import { addDays } from "date-fns";
import {
  isProjectComplete,
  isProjectInFlight,
  type Project,
  type VerticalData,
} from "./vertical";
import { lensGaps, projectReadinessAxes, type LensGap, type ReadinessAxes } from "./lenses";
import { demandByWeekDetailed, projectPace, type ProjectPace } from "./pace";
import { weekForecast, type WeekCapacity } from "./capacity";

/** How many near weeks the timeline shows before it's just noise (knob). */
export const HORIZON_WEEKS = 3;
/** Display unit — a "focus block". Math stays in minutes; this only rounds for
 *  the eye. Align with Sunday's batched focus blocks so "2 blocks here" means
 *  "2 blocks there". */
export const BLOCK_MINS = 90;

const toBlocks = (mins: number) => Math.round(mins / BLOCK_MINS);

export type LaneState = "ready" | "needs_shaping" | "stalled" | "idea" | "parked";

/** The card's readiness ramp — how groomed a project is, independent of pace.
 *  `ready` = all 3 checks met (pull it into a week), `grooming` = 1–2 met,
 *  `raw` = 0 met (untouched idea), `parked` = deliberately resting, `done` =
 *  completed but still shown in its week (drops off once that week is past). */
export type ReadyTier = "ready" | "grooming" | "raw" | "parked" | "done";

export interface OnDeckLane {
  project: Project;
  pace: ProjectPace;
  /** the named readiness gaps (lens router) — empty = nothing to groom. */
  gaps: LensGap[];
  state: LaneState;
  /** the 3-check "definition of ready" — Defined · Planned · Fits. */
  axes: ReadinessAxes;
  /** how many of the 3 checks are met (0..3) — the meter fill + "N/3". */
  readyCount: number;
  /** readiness tier for the card's color ramp (pace-independent). */
  readyTier: ReadyTier;
  /** first horizon week the bar starts in (0 = this week). */
  startWeekIdx: number;
  /** horizon week the finish line lands in; null = beyond the window (bar extends). */
  dueWeekIdx: number | null;
}

export interface WeekColumn {
  weekStart: Date;
  idx: number;
  availMins: number;
  demandMins: number;
  over: boolean;
  blocks: number;
  demandBlocks: number;
}

export interface Pinch {
  weekIdx: number;
  overByMins: number;
  culprits: Project[];
  /** the one deterministic sentence — the steward voice, never AI. */
  line: string;
}

export interface OnDeckBoard {
  weeks: WeekColumn[];
  lanes: OnDeckLane[];
  pinch: Pinch | null;
  /** "weeks stocked" — Σ remaining ready-work ÷ a typical week (one decimal). */
  coverageWeeks: number;
  horizonWeeks: number;
}

function weekLabel(idx: number, weekStart: Date): string {
  if (idx === 0) return "This week";
  if (idx === 1) return "Next week";
  return `Week of ${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function pinchLine(idx: number, col: WeekColumn, culprits: Project[]): string {
  const label = weekLabel(idx, col.weekStart);
  const top = culprits[0]?.name ?? "a project";
  const tail =
    culprits.length > 1
      ? `${top} slips unless you start it now or push ${culprits[1].name} out`
      : `${top} slips unless you start it this week`;
  const blk = (n: number) => `${n} block${n === 1 ? "" : "s"}`;
  return `${label} wants ~${blk(col.demandBlocks)} and you have ${blk(col.blocks)} — ${tail}.`;
}

/** Read the whole On Deck board in one pass. */
export function readOnDeck(
  d: VerticalData,
  byWeek: WeekCapacity[],
  weeklyAvgMins: number,
  now: Date,
  horizonWeeks: number = HORIZON_WEEKS,
  /** Keep completed projects on the board as long as their week is still in the
   *  horizon (this week or later) — a "done, not gone" state for the planner.
   *  Off by default so the compact hub / groom queue stay demand-only. */
  includeCompleted: boolean = false,
): OnDeckBoard {
  const horizon = byWeek.slice(0, horizonWeeks);
  const forecast = weekForecast(d, now, horizon, weeklyAvgMins);
  const detailed = demandByWeekDetailed(d, now, horizon.map((w) => w.weekStart));

  const weeks: WeekColumn[] = horizon.map((w, i) => ({
    weekStart: w.weekStart,
    idx: i,
    availMins: w.availMins,
    demandMins: forecast[i]?.demandMins ?? 0,
    over: forecast[i]?.over ?? false,
    blocks: toBlocks(w.availMins),
    demandBlocks: toBlocks(forecast[i]?.demandMins ?? 0),
  }));

  const horizonStartMs = horizon.length ? horizon[0].weekStart.getTime() : now.getTime();
  const horizonEndMs = horizon.length ? addDays(horizon[horizon.length - 1].weekStart, 7).getTime() : now.getTime();

  // A completed project stays on the board only while its finish week is still
  // shown (this week or later) — once that week is behind us it's out of the
  // horizon and drops off on its own.
  const completeInHorizon = (p: Project): boolean => {
    if (!includeCompleted || !isProjectComplete(p.status) || !p.targetDate) return false;
    const t = new Date(p.targetDate + "T23:59:59").getTime();
    return t >= horizonStartMs && t < horizonEndMs;
  };

  const lanes: OnDeckLane[] = d.projects
    .filter((p) => (isProjectInFlight(p.status) && !isProjectComplete(p.status)) || completeInHorizon(p))
    .map((project) => {
      const complete = isProjectComplete(project.status);
      const pace = projectPace(d, project, now);
      const gaps = lensGaps(d, "project", project, now);
      const axes = projectReadinessAxes(d, project, now);
      const readyCount = complete ? 3 : [axes.defined, axes.planned, axes.fits].filter((a) => a === true).length;

      // due week within the horizon: overdue / before window → 0, beyond → null.
      let dueWeekIdx: number | null = null;
      const targetMs = project.targetDate ? new Date(project.targetDate + "T23:59:59").getTime() : null;
      if (targetMs != null) {
        if (targetMs < horizonStartMs) dueWeekIdx = 0;
        else if (targetMs >= horizonEndMs) dueWeekIdx = null;
        else {
          const idx = horizon.findIndex((w) => {
            const ws = w.weekStart.getTime();
            return targetMs >= ws && targetMs < addDays(w.weekStart, 7).getTime();
          });
          dueWeekIdx = idx >= 0 ? idx : null;
        }
      }

      const state: LaneState =
        project.status === "waiting"
          ? "parked"
          : pace.read === "undated" || !project.targetDate
            ? "idea"
            : gaps.length > 0
              ? "needs_shaping"
              : pace.read === "stalled" || pace.read === "overdue" || pace.read === "behind"
                ? "stalled"
                : "ready";

      const readyTier: ReadyTier = complete
        ? "done"
        : state === "parked" ? "parked" : readyCount >= 3 ? "ready" : readyCount === 0 ? "raw" : "grooming";

      return { project, pace, gaps, state, axes, readyCount, readyTier, startWeekIdx: 0, dueWeekIdx };
    });

  // Demand order: most overdue first, then behind/stalled, then soonest due, then
  // undated ideas, parked last.
  const rank = (l: OnDeckLane): number => {
    if (l.readyTier === "done") return 3e9; // finished — sits below live work
    if (l.state === "parked") return 2e9;
    if (l.pace.read === "overdue") return -1e6 - (l.pace.driftDays ?? 0);
    if (l.pace.read === "behind" || l.pace.read === "stalled") return -1e5 + (l.pace.daysLeft ?? 0);
    if (l.pace.daysLeft != null) return l.pace.daysLeft;
    return 1e8;
  };
  lanes.sort((a, b) => rank(a) - rank(b));

  // The pinch — the first week over capacity, attributed to the projects that
  // land in it (worst pace first).
  let pinch: Pinch | null = null;
  const overIdx = weeks.findIndex((w) => w.over);
  if (overIdx >= 0) {
    const col = weeks[overIdx];
    const culprits = (detailed[overIdx]?.contributors ?? [])
      .slice()
      .sort((a, b) => (projectPace(d, b.project, now).driftDays ?? -Infinity) - (projectPace(d, a.project, now).driftDays ?? -Infinity))
      .map((c) => c.project);
    pinch = {
      weekIdx: overIdx,
      overByMins: Math.max(0, col.demandMins - (forecast[overIdx]?.freeMins ?? col.availMins)),
      culprits,
      line: pinchLine(overIdx, col, culprits),
    };
  }

  // Coverage — how many weeks of *ready* (schedulable) work is queued against a
  // typical week. Schedulable = defined && planned (the axis checklist,
  // docs/grooming-lenses.md §4) — so grooming a brief visibly stocks the weeks.
  const readyMins = d.projects
    .filter((p) => {
      if (!isProjectInFlight(p.status) || isProjectComplete(p.status)) return false;
      const axes = projectReadinessAxes(d, p, now);
      return axes.defined && axes.planned;
    })
    .reduce((sum, p) => sum + projectPace(d, p, now).remainingMins, 0);
  const coverageWeeks = weeklyAvgMins > 0 ? Math.round((readyMins / weeklyAvgMins) * 10) / 10 : 0;

  return { weeks, lanes, pinch, coverageWeeks, horizonWeeks: horizon.length };
}

// ── The "why now" band — one project's demand context, for the Groom deck ─────
export interface DemandContext {
  line: string;
  dueLabel: string | null;
  needsBlocks: number;
  openBlocks: number;
  overdue: boolean;
}

function relLabel(daysLeft: number | null): string {
  if (daysLeft == null) return "soon";
  if (daysLeft <= 7) return "this week";
  if (daysLeft <= 14) return "next week";
  return `in ${Math.round(daysLeft / 7)} weeks`;
}

/** The demand sentence a Groom card leads with — why this project, why now. Only
 *  projects carry pace, so initiatives return null (their band is skipped). */
export function demandContext(
  d: VerticalData,
  byWeek: WeekCapacity[],
  weeklyAvgMins: number,
  ref: { kind: "project" | "initiative"; id: string },
  now: Date,
): DemandContext | null {
  if (ref.kind !== "project") return null;
  const p = d.projects.find((x) => x.id === ref.id);
  if (!p) return null;
  const pace = projectPace(d, p, now);
  const needsBlocks = Math.max(1, toBlocks(pace.remainingMins));
  const blk = (n: number) => `${n} block${n === 1 ? "" : "s"}`;

  if (pace.read === "overdue") {
    return {
      line: `Overdue by ${pace.driftDays ?? 0}d and it still needs ~${blk(needsBlocks)} — groom it to salvage a finish.`,
      dueLabel: "overdue",
      needsBlocks,
      openBlocks: 0,
      overdue: true,
    };
  }
  if (!p.targetDate || pace.read === "undated") {
    return {
      line: `No finish line yet — set one so the week can pull this in.`,
      dueLabel: null,
      needsBlocks,
      openBlocks: 0,
      overdue: false,
    };
  }

  // the week the finish line lands in → its realistic open time
  const targetMs = new Date(p.targetDate + "T23:59:59").getTime();
  let openMins = weeklyAvgMins;
  let idx = -1;
  for (let i = 0; i < byWeek.length; i++) {
    const ws = byWeek[i].weekStart.getTime();
    if (targetMs >= ws && targetMs < addDays(byWeek[i].weekStart, 7).getTime()) {
      idx = i;
      openMins = i === 0 ? byWeek[i].availMins : Math.min(byWeek[i].availMins, weeklyAvgMins);
      break;
    }
  }
  const openBlocks = Math.max(0, toBlocks(openMins));
  const label = idx < 0 ? relLabel(pace.daysLeft) : weekLabel(idx, byWeek[idx].weekStart).toLowerCase();
  return {
    line: `Due ${label} and it needs ~${blk(needsBlocks)}. That week has ${blk(openBlocks)} open — groom it so Sunday can place it.`,
    dueLabel: label,
    needsBlocks,
    openBlocks,
    overdue: false,
  };
}
