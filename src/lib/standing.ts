// The Standing — the interpretive front door of the Project / Initiative floors.
// Where the spine gauge reports ONE number (readiness) and the Refine run is the
// play that moves it, the Standing is the chief-of-staff read that sits above the
// working surface: three honest axes an operator carries when holding a stack of
// projects, said in a sentence, with the one convergent exception named.
//
//   • Defined  — is the work shaped enough to run?      (readinessOf*Floor)
//   • Capacity — can you carry what's in flight?         (WIP-first, overdue-aware)
//   • Motion   — is it actually advancing?               (last-activity / silent)
//
// Pure over a VerticalData snapshot, exactly like readiness.ts / tending.ts. It is
// assessment ONLY — it never prescribes a fix; the single action it offers is to
// hand off to the Refine run. Capacity is deliberately WIP-first (no calendar
// math): the live-data probe showed a pure hours model scores an unshaped, overdue
// project at ZERO demand — it tells a comfortable lie about exactly the projects
// that weigh on you. WIP-first can't. Per-project calendar feasibility
// (refineFeasibility.ts) is a later enrichment, never the verdict.

import { differenceInCalendarDays } from "date-fns";
import {
  isProjectInFlight,
  looseTasksOfInitiative,
  projectsOf,
  tasksOf,
  type Initiative,
  type Project,
  type VTask,
  type VerticalData,
} from "./vertical";
import { ripenessOfInitiative, ripenessOfProject } from "./tending";
import { CALM, readinessOfInitiativeFloor, readinessOfProjectFloor } from "./readiness";
import { parseDateISO, todayISO } from "./dates";

// ── Knobs (tune against the running app) — the WIP-first thresholds the live
// probe validated: 3+ parallel is already Tight, 5+ is Overcommitted, and a
// project that completed nothing in a week has lost Motion. ───────────────────
const WIP_COMFORT = 3; // at or above → at least Tight
const WIP_MAX = 5; //     at or above → Overcommitted on count alone
const MOTION_DAYS = 7; //  finished a task within a week = still moving

export type Band = "comfortable" | "tight" | "overcommitted";
export type Kind = "project" | "initiative";

/** Per in-flight item, the three signals that compose the floor read. */
interface ItemRead {
  id: string;
  name: string;
  overdue: boolean;
  daysOverdue: number;
  /** raw (just a name) or no tasks at all — can't be carried, can't be measured. */
  hollow: boolean;
  moving: boolean;
  /** days since the last completed task; null = nothing ever finished. */
  daysSinceTouch: number | null;
}

export interface Standing {
  kind: Kind;
  inFlight: number;
  /** 0..1 — the same number the spine and Refine portfolio meter report. */
  defined: number;
  definedBlurb: string;
  capacity: Band;
  capacityBlurb: string;
  motionMoving: number;
  motionTotal: number;
  motionBlurb: string;
  /** one Fraunces sentence — pure assessment, never a prescription. */
  synthesis: string;
  /** the item flagged by the most axes — the chief-of-staff's "one thing". */
  focus: { id: string; kind: Kind; name: string } | null;
  /** true when there's nothing in flight and the floor is shaped — the reward. */
  calm: boolean;
}

function itemTasks(d: VerticalData, kind: Kind, id: string): VTask[] {
  if (kind === "project") return tasksOf(d, id);
  return [...looseTasksOfInitiative(d, id), ...projectsOf(d, id).flatMap((p) => tasksOf(d, p.id))];
}

function lastDoneDays(tasks: VTask[], now: Date): number | null {
  let last: number | null = null;
  for (const t of tasks) {
    if (t.status === "done" && t.completedAt) {
      const at = new Date(t.completedAt).getTime();
      if (!Number.isNaN(at) && (last == null || at > last)) last = at;
    }
  }
  if (last == null) return null;
  return Math.max(0, Math.floor((now.getTime() - last) / 86_400_000));
}

function daysLeftOf(targetDate: string | null, now: Date): number | null {
  if (!targetDate) return null;
  const t = parseDateISO(targetDate);
  if (Number.isNaN(t.getTime())) return null;
  return differenceInCalendarDays(t, parseDateISO(todayISO(now)));
}

function readItem(d: VerticalData, kind: Kind, item: Project | Initiative, now: Date): ItemRead {
  const stage =
    kind === "project"
      ? ripenessOfProject(d, item as Project).stage
      : ripenessOfInitiative(d, item as Initiative).stage;
  const tasks = itemTasks(d, kind, item.id);
  const left = daysLeftOf(item.targetDate ?? null, now);
  const touch = lastDoneDays(tasks, now);
  return {
    id: item.id,
    name: item.name,
    overdue: left != null && left < 0,
    daysOverdue: left != null && left < 0 ? -left : 0,
    hollow: stage === "raw" || tasks.length === 0,
    moving: touch != null && touch <= MOTION_DAYS,
    daysSinceTouch: touch,
  };
}

/** Read a floor's Standing — three axes + a synthesis, pure over the snapshot. */
export function readStanding(d: VerticalData, kind: Kind, now: Date = new Date()): Standing {
  const items: (Project | Initiative)[] =
    kind === "project"
      ? d.projects.filter((p) => isProjectInFlight(p.status))
      : d.initiatives.filter((i) => isProjectInFlight(i.status));
  const reads = items.map((it) => readItem(d, kind, it, now));
  const N = reads.length;

  const defined = kind === "project" ? readinessOfProjectFloor(d) : readinessOfInitiativeFloor(d);

  // ── Capacity — WIP-first, overdue-aware. A "liability" is an in-flight item
  // you can't honor as-is: overdue, or hollow (no path / nothing to measure).
  const liabilities = reads.filter((r) => r.overdue || r.hollow);
  const anyOverdue = reads.some((r) => r.overdue);
  let capacity: Band = "comfortable";
  if (N > 0 && (anyOverdue || liabilities.length >= 2 || N >= WIP_MAX)) capacity = "overcommitted";
  else if (N >= WIP_COMFORT || liabilities.length >= 1) capacity = "tight";

  // ── Motion — moving vs stalled, worst-first for the cue.
  const moving = reads.filter((r) => r.moving).length;
  const stalled = reads
    .filter((r) => !r.moving)
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        b.daysOverdue - a.daysOverdue ||
        (b.daysSinceTouch ?? Infinity) - (a.daysSinceTouch ?? Infinity),
    );

  // ── Defined — name the in-flight items still without a path.
  const rawInFlight = reads.filter((r) => r.hollow).length;

  // ── The one convergent thing: most axes lit at once.
  const scored = reads
    .map((r) => ({ r, score: Number(r.overdue) + Number(r.hollow) + Number(!r.moving) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.daysOverdue - a.r.daysOverdue);
  const focus = scored.length ? { id: scored[0].r.id, kind, name: scored[0].r.name } : null;

  const calm = N === 0 && defined >= CALM;
  const noun = kind === "project" ? "project" : "initiative";

  // ── Blurbs — specific, data-true; the cue doctrine (one exception, not a list).
  const definedBlurb =
    rawInFlight > 0
      ? `${rawInFlight} of ${N} in flight ${rawInFlight === 1 ? "has" : "have"} no path yet — just a name.`
      : defined >= CALM
        ? `Everything in flight is shaped enough to run.`
        : `Shaped enough to start, not yet to finish.`;

  const overdueItems = reads.filter((r) => r.overdue);
  const hollowOnly = reads.filter((r) => r.hollow && !r.overdue);
  const capacityBlurb =
    N === 0
      ? `Nothing in flight — room to commit.`
      : capacity === "overcommitted"
        ? overdueItems.length
          ? `${overdueItems[0].name} is ${overdueItems[0].daysOverdue}d overdue${hollowOnly.length ? `; ${hollowOnly.length} more carry no plan.` : "."}`
          : `${N} in flight, ${liabilities.length} without a path to finish.`
        : capacity === "tight"
          ? liabilities.length
            ? `${N} in flight; ${liabilities.length} ${liabilities.length === 1 ? "carries" : "carry"} no plan yet.`
            : `${N} in flight — at the edge of what fits.`
          : `${N} in flight, each on a path.`;

  const worst = stalled[0];
  const motionBlurb =
    N === 0
      ? `Nothing in motion.`
      : !worst
        ? `All ${N} advancing.`
        : worst.overdue && worst.hollow
          ? `${worst.name} is ${worst.daysOverdue}d overdue, never started.`
          : worst.daysSinceTouch == null
            ? `${worst.name} hasn't moved yet.`
            : `${worst.name} hasn't moved in ${worst.daysSinceTouch} days.`;

  let synthesis: string;
  if (calm) {
    synthesis = `Nothing in flight, nothing slipping — the ${noun} floor is at rest.`;
  } else {
    const motionPart = N
      ? `${moving} of ${N} in flight ${moving === 1 ? "is" : "are"} moving.`
      : `Nothing's in flight yet.`;
    const capPart =
      capacity === "overcommitted"
        ? `The week is carrying more than it can hold`
        : capacity === "tight"
          ? `You're near the edge of what fits`
          : `There's room to take more on`;
    const defPart =
      rawInFlight > 0 ? `, and ${rawInFlight} ${rawInFlight === 1 ? "is" : "are"} still unshaped.` : ".";
    synthesis = `${motionPart} ${capPart}${defPart}`;
  }

  return {
    kind,
    inFlight: N,
    defined,
    definedBlurb,
    capacity,
    capacityBlurb,
    motionMoving: moving,
    motionTotal: N,
    motionBlurb,
    synthesis,
    focus,
    calm,
  };
}
