// Pace — the primitive that turns a project into a weekly *rate*, so the
// portfolio (deadlines) and the week (hours) finally speak the same unit.
//
//   required pace = remaining effort ÷ weeks until the finish line
//
// Remaining effort is bottom-up: the sum of open task estimates (durationMins
// defaults to 30, so any scaffolded project is sized for free). Actual pace is
// the trailing completion rate — the same completed-block signal presence
// reads (vertical.ts §invested), but scoped to one project. From those two we
// project a finish date and the drift against the target.
//
// This is deliberately calendar-free: it answers "is this one bet on pace?" at
// the project altitude. The portfolio Demand÷Capacity meter (which divides by
// real calendar-derived hours) is built on top of this, not inside it.

import { differenceInCalendarDays } from "date-fns";
import { isProjectInFlight, tasksOf, type Project, type VerticalData } from "./vertical";

/** How far back we look to read a project's *actual* weekly throughput. */
const TREND_WINDOW_DAYS = 21;
/** Drift within this many days of the target still reads as "on pace". */
const ON_TRACK_SLACK_DAYS = 4;
const WEEK_MS = 7 * 86_400_000;

export type PaceRead =
  | "clear" // not complete, but no open work queued — nothing to pace
  | "undated" // has open work but no finish line — can't compute a required rate
  | "overdue" // the finish line has passed with work remaining
  | "stalled" // dated work remains but no recent motion — can't project a finish
  | "behind" // at the current rate, it lands after the target
  | "on_track"
  | "ahead";

export interface ProjectPace {
  /** Bottom-up remaining effort = Σ open task estimates. */
  remainingMins: number;
  remainingHours: number; // one-decimal, for display
  /** Calendar days to the target (null when undated, negative when overdue). */
  daysLeft: number | null;
  /** Hours/week needed from now to finish on time. */
  requiredMinsPerWeek: number;
  /** Hours/week actually delivered over the trailing window. */
  recentMinsPerWeek: number;
  /** Where the project lands at its recent rate (null when stalled/undated). */
  projectedFinish: Date | null;
  /** projectedFinish − target, in days. Positive = behind, negative = ahead. */
  driftDays: number | null;
  read: PaceRead;
}

export function projectPace(d: VerticalData, p: Project, now: Date): ProjectPace {
  const ts = tasksOf(d, p.id);
  const remainingMins = ts
    .filter((t) => t.status !== "done")
    .reduce((sum, t) => sum + (t.durationMins || 0), 0);
  const remainingHours = Math.round((remainingMins / 60) * 10) / 10;

  // Actual throughput — work this project *completed* inside the trailing window.
  const winStart = now.getTime() - TREND_WINDOW_DAYS * 86_400_000;
  const recentDoneMins = ts.reduce((sum, t) => {
    if (t.status !== "done" || !t.completedAt) return sum;
    const at = new Date(t.completedAt).getTime();
    if (Number.isNaN(at) || at < winStart || at > now.getTime()) return sum;
    return sum + (t.durationMins || 0);
  }, 0);
  const recentMinsPerWeek = (recentDoneMins / TREND_WINDOW_DAYS) * 7;

  const base = { remainingMins, remainingHours, recentMinsPerWeek };
  const idle = { ...base, daysLeft: null, requiredMinsPerWeek: 0, projectedFinish: null, driftDays: null };

  if (remainingMins === 0) return { ...idle, read: "clear" };
  if (!p.targetDate) return { ...idle, read: "undated" };

  const target = new Date(p.targetDate + "T23:59:59");
  if (Number.isNaN(target.getTime())) return { ...idle, read: "undated" };

  const daysLeft = differenceInCalendarDays(target, now);
  if (daysLeft < 0) {
    return { ...base, daysLeft, requiredMinsPerWeek: remainingMins, projectedFinish: null, driftDays: -daysLeft, read: "overdue" };
  }

  const weeksLeft = Math.max(daysLeft / 7, 1 / 7); // never divide by zero — at least a day
  const requiredMinsPerWeek = remainingMins / weeksLeft;

  if (recentMinsPerWeek <= 0) {
    return { ...base, daysLeft, requiredMinsPerWeek, projectedFinish: null, driftDays: null, read: "stalled" };
  }

  const projectedFinish = new Date(now.getTime() + (remainingMins / recentMinsPerWeek) * WEEK_MS);
  const driftDays = differenceInCalendarDays(projectedFinish, target);
  const read: PaceRead =
    driftDays > ON_TRACK_SLACK_DAYS ? "behind" : driftDays < -ON_TRACK_SLACK_DAYS ? "ahead" : "on_track";

  return { ...base, daysLeft, requiredMinsPerWeek, projectedFinish, driftDays, read };
}

/** A read where a finishing rate is genuinely owed this week. */
const PRESSING: ReadonlySet<PaceRead> = new Set<PaceRead>(["behind", "overdue", "stalled"]);

export interface PortfolioDemand {
  /** Σ required pace across every in-flight project that's sized + dated — the
   *  portfolio's weekly hours-demand, in the same unit as calendar capacity. */
  perWeekMins: number;
  /** Sized + dated projects contributing a required rate, biggest demand first. */
  counted: { project: Project; pace: ProjectPace }[];
  /** In flight but invisible to the meter — unsized or undated. The refine queue. */
  latent: { project: Project; pace: ProjectPace }[];
  /** Counted projects drifting (behind / overdue / stalled), worst drift first. */
  pressing: { project: Project; pace: ProjectPace }[];
}

/** Roll every in-flight project up into one weekly demand — the numerator of
 *  the Commitment ratio (Demand ÷ calendar-derived Capacity). */
export function portfolioDemand(d: VerticalData, now: Date): PortfolioDemand {
  const counted: PortfolioDemand["counted"] = [];
  const latent: PortfolioDemand["latent"] = [];
  const pressing: PortfolioDemand["pressing"] = [];
  let perWeekMins = 0;

  for (const project of d.projects) {
    if (!isProjectInFlight(project.status)) continue;
    const pace = projectPace(d, project, now);
    if (pace.requiredMinsPerWeek > 0) {
      perWeekMins += pace.requiredMinsPerWeek;
      counted.push({ project, pace });
    } else if (pace.read === "undated" || pace.read === "clear") {
      latent.push({ project, pace });
    }
    if (PRESSING.has(pace.read)) pressing.push({ project, pace });
  }

  counted.sort((a, b) => b.pace.requiredMinsPerWeek - a.pace.requiredMinsPerWeek);
  pressing.sort((a, b) => (b.pace.driftDays ?? 0) - (a.pace.driftDays ?? 0));
  return { perWeekMins, counted, latent, pressing };
}

export interface WeekDemand {
  weekStart: Date;
  demandMins: number;
}

export interface WeekDemandDetailed extends WeekDemand {
  /** which in-flight projects contribute to this week's demand, and how much each
   *  owes — kept so the On Deck timeline can draw per-project bars and name the
   *  culprits behind a pinch. */
  contributors: { project: Project; mins: number }[];
}

/** Spread each project's required pace across the weeks it's actually in play —
 *  from now until its target — keeping project identity. Overdue work lands
 *  entirely on the first (current) week; it's owed now. `weekStarts` should come
 *  from the capacity read so the two stay index-aligned. */
export function demandByWeekDetailed(d: VerticalData, now: Date, weekStarts: Date[]): WeekDemandDetailed[] {
  const { counted } = portfolioDemand(d, now);
  const firstWeekMs = weekStarts.length ? weekStarts[0].getTime() : 0;

  return weekStarts.map((weekStart) => {
    const ws = weekStart.getTime();
    let demandMins = 0;
    const contributors: { project: Project; mins: number }[] = [];
    for (const { project, pace } of counted) {
      let mins = 0;
      if (pace.read === "overdue") {
        if (ws === firstWeekMs) mins = pace.requiredMinsPerWeek; // owed now
      } else {
        const target = project.targetDate ? new Date(project.targetDate + "T23:59:59").getTime() : null;
        if (target != null && target >= ws) mins = pace.requiredMinsPerWeek;
      }
      if (mins > 0) {
        demandMins += mins;
        contributors.push({ project, mins });
      }
    }
    return { weekStart, demandMins, contributors };
  });
}

/** Per-week demand totals (the ribbon) — the detail-free view onto
 *  `demandByWeekDetailed`, kept for the Commitment meter. */
export function demandByWeek(d: VerticalData, now: Date, weekStarts: Date[]): WeekDemand[] {
  return demandByWeekDetailed(d, now, weekStarts).map(({ weekStart, demandMins }) => ({ weekStart, demandMins }));
}
