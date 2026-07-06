// Grooming lenses — the axis checklist + the router (docs/grooming-lenses.md §4).
// Where tending.ts reads one flat readiness number, this reads an INSPECTABLE
// per-item checklist: each axis is closed by exactly one lens (Brief → Defined,
// Path → Planned; On Deck reads Fits as an advisory overlay). Pure over a
// VerticalData snapshot, like readiness.ts — no new scoring, only predicates
// over existing fields + the `brief` document.
//
// Schedulable = defined && planned. `fits` never gates — it's the timeline's
// advisory read (pace vs the calendar), surfaced on On Deck, not a to-do.

import {
  initiativeById,
  isOpenStatus,
  isProjectComplete,
  projectById,
  projectsOf,
  tasksOf,
  type Initiative,
  type ItemBrief,
  type Project,
  type VerticalData,
} from "./vertical";
import { projectPace } from "./pace";
import { verdictOf } from "./tending";
import type { RefineCardKind } from "./refine";

export type LensKind = "brief" | "path";

export const LENS_LABEL: Record<LensKind, string> = {
  brief: "Brief",
  path: "Path",
};

/** The §4 card-kind → lens map: which lens hosts each of the old deck's gaps.
 *  "reality" belongs to On Deck (the hub reads Fits); nothing maps to a card
 *  anymore — the verdict-layer repairs become lens prefills. */
export const CARD_LENS: Record<RefineCardKind, LensKind | "ondeck"> = {
  outcome: "brief",
  sharpen: "brief",
  due: "brief",
  tasks: "path",
  reality: "ondeck",
};

export interface ReadinessAxes {
  /** The Brief's axis: outcome + scope + acceptance + a finish line. */
  defined: boolean;
  /** The Path's axis: open steps exist (projects) / structure exists (bets). */
  planned: boolean;
  /** On Deck's advisory read — null where pace doesn't apply (initiatives). */
  fits: boolean | null;
}

/** A brief counts once it carries scope AND acceptance — the two sections that
 *  make "done" adjudicable. Questions/constraints are welcome but optional. */
export function briefHasSubstance(brief: ItemBrief | null | undefined): boolean {
  return (brief?.scope?.length ?? 0) > 0 && (brief?.doneWhen?.length ?? 0) > 0;
}

export function projectReadinessAxes(d: VerticalData, p: Project, now: Date): ReadinessAxes {
  const defined = p.outcome.trim() !== "" && briefHasSubstance(p.brief) && p.targetDate != null;
  const planned = tasksOf(d, p.id).some((t) => t.status !== "done");
  const verdict = verdictOf(d, "project", p.id);
  const fits =
    projectPace(d, p, now).read !== "overdue" && verdict?.time.read !== "unrealistic";
  return { defined, planned, fits };
}

export function initiativeReadinessAxes(d: VerticalData, i: Initiative): ReadinessAxes {
  const defined = i.outcome.trim() !== "" && briefHasSubstance(i.brief) && i.targetDate != null;
  const planned =
    i.keyResults.length > 0 || projectsOf(d, i.id).some((p) => isOpenStatus(p.status));
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
      label: !item.outcome.trim()
        ? "no outcome"
        : !briefHasSubstance(item.brief)
          ? "scope unclear"
          : "no finish line",
    });
  }
  if (!axes.planned) {
    gaps.push({ lens: "path", label: kind === "project" ? "no steps" : "no structure" });
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
