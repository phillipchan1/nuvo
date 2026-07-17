// Grooming lenses — the axis checklist + the router (docs/grooming-lenses.md §4).
// Where tending.ts reads one flat readiness number, this reads an INSPECTABLE
// per-item checklist: each axis is closed by exactly one lens (Brief → Defined,
// Path → Planned; On Deck reads Fits as an advisory overlay). Pure over a
// VerticalData snapshot, like readiness.ts — no new scoring, only predicates
// over existing fields.
//
// Every predicate here must name something a real surface can CLOSE. If no UI
// can write the field, it isn't readiness — it's a dead gate (see the note on
// the brief document below).
//
// Schedulable = defined && planned. `fits` never gates — it's the timeline's
// advisory read (pace vs the calendar), surfaced on On Deck, not a to-do.

import {
  initiativeById,
  isOpenStatus,
  isProjectComplete,
  projectById,
  tasksOf,
  type Initiative,
  type Project,
  type VerticalData,
} from "./vertical";
import { projectPace } from "./pace";
import { verdictOf } from "./tending";

export type LensKind = "brief" | "path" | "okr";

export const LENS_LABEL: Record<LensKind, string> = {
  brief: "Brief",
  path: "Path",
  okr: "OKRs",
};

/** A groomable target, optionally pinned to one lens — what the hub's chips and
 *  the guided pass hand the flow host. */
export type LensRef = { kind: "project" | "initiative"; id: string; lens?: LensKind };

export interface ReadinessAxes {
  /** The Brief's axis: an outcome + a finish line — what the Groom deck closes. */
  defined: boolean;
  /** The Path's axis: open steps exist (projects) / structure exists (bets). */
  planned: boolean;
  /** On Deck's advisory read — null where pace doesn't apply (initiatives). */
  fits: boolean | null;
}

// The `brief` document (scope / non-goals / acceptance) is NOT part of Defined
// any more. It used to be — `defined` required brief.scope + brief.doneWhen — but
// the model moved on: the Groom deck collapsed the brief into the single outcome
// line ("one line that defines done"), and no surface writes the jsonb document
// at all. So the check could never pass: every project read "scope unclear"
// forever, however well it was groomed, and "N need shaping" could never fall.
// A gate with no door teaches nothing — it just punishes. Defined is now exactly
// what the Groom deck actually closes: an outcome, and a week to do it in.

export function projectReadinessAxes(d: VerticalData, p: Project, now: Date): ReadinessAxes {
  const defined = p.outcome.trim() !== "" && p.targetDate != null;
  const planned = tasksOf(d, p.id).some((t) => t.status !== "done");
  const verdict = verdictOf(d, "project", p.id);
  const fits =
    projectPace(d, p, now).read !== "overdue" && verdict?.time.read !== "unrealistic";
  return { defined, planned, fits };
}

export function initiativeReadinessAxes(d: VerticalData, i: Initiative): ReadinessAxes {
  void d;
  const defined = i.outcome.trim() !== "" && i.targetDate != null;
  // OKRs are a bet's prime property: it isn't "planned" until it carries at least
  // one measurable key result. Child projects are execution *under* the outcome —
  // they no longer substitute for having a number to move.
  const planned = i.keyResults.length > 0;
  return { defined, planned, fits: null };
}

export function itemReadinessAxes(
  d: VerticalData,
  kind: "project" | "initiative",
  id: string,
  now: Date,
): ReadinessAxes | null {
  if (kind === "project") {
    const p = projectById(d, id);
    return p ? projectReadinessAxes(d, p, now) : null;
  }
  const i = initiativeById(d, id);
  return i ? initiativeReadinessAxes(d, i) : null;
}

// ── The router — which lens(es) an item still needs, in ladder order ─────────
export interface LensGap {
  lens: LensKind;
  /** the hub's short gap name — WHY this lens, legible on a lane. */
  label: string;
}

/** The gaps an item still carries, Brief before Path (the ladder). Empty for
 *  complete / cancelled / parked items — parked is settled by choice, not debt. */
export function lensGaps(
  d: VerticalData,
  kind: "project" | "initiative",
  item: Project | Initiative,
  now: Date,
): LensGap[] {
  if (!isOpenStatus(item.status) || isProjectComplete(item.status)) return [];
  if (item.status === "waiting") return []; // resting — out of the ladder
  const axes =
    kind === "project"
      ? projectReadinessAxes(d, item as Project, now)
      : initiativeReadinessAxes(d, item as Initiative);
  const gaps: LensGap[] = [];
  if (!axes.defined) {
    gaps.push({
      lens: "brief",
      // Both gaps name a thing you can actually go do. ("scope unclear" used to
      // sit between them; it named a document that couldn't be written.)
      label: !item.outcome.trim() ? "no outcome" : "no finish line",
    });
  }
  if (!axes.planned) {
    gaps.push(
      kind === "project"
        ? { lens: "path", label: "no steps" }
        : { lens: "okr", label: "no key results" },
    );
  }
  return gaps;
}

/** Just the lenses, for queue building. */
export function lensesFor(
  d: VerticalData,
  kind: "project" | "initiative",
  item: Project | Initiative,
  now: Date,
): LensKind[] {
  return lensGaps(d, kind, item, now).map((g) => g.lens);
}

/** Every open item on a floor that still needs a lens, in the floor's own
 *  order — the panel's to-groom list and the Initiatives guided-pass queue. */
export function itemsNeedingLenses(
  d: VerticalData,
  kind: "project" | "initiative",
  now: Date,
): { item: Project | Initiative; gaps: LensGap[] }[] {
  const items: (Project | Initiative)[] = kind === "project" ? d.projects : d.initiatives;
  return items
    .map((item) => ({ item, gaps: lensGaps(d, kind, item, now) }))
    .filter((x) => x.gaps.length > 0);
}
