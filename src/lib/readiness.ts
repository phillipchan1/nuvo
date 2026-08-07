// Readiness — the funnel made visible. Each altitude ("floor") is judged by one
// question: is it *ready for the floor below?* Pure over a VerticalData snapshot,
// exactly like tending.ts / now.ts — the spine reads these everywhere and the
// reward state ("all at rest") rolls up from them. Full rationale in
// docs/readiness-model.md.
//
// The load-bearing choice (§2): a floor is ready when its open items are
// SETTLED — each one moving toward the floor below, OR deliberately at rest —
// NOT "finished." A parked item is settled by choice, never debt, so "calm" is
// reachable weekly instead of a perpetual deficit. The meter shows that ambient
// state; a CUE surfaces only the single thing genuinely slipping (§4).

import {
  initiativesOf,
  inboxTasks,
  isOpenStatus,
  looseProjectsOf,
  sprintTasks,
  type Domain,
  type Initiative,
  type Project,
  type VerticalData,
} from "./vertical";
import {
  effectiveScore,
  readTending,
  ripenessOfInitiative,
  ripenessOfProject,
  type GroomCandidate,
} from "./tending";
import { projectsOnDeck } from "./priorities";
import { planningWeekStartISO } from "./dates";

// ── Floors — the readiness elevations, by their Rung id ──────────────────────
// Readiness is directional: a floor is ready when its contents are groomed
// enough for the floor BELOW to consume. So readiness lives on the four
// elevations that each groom for a consumer — Schedule (legacy id "day"),
// Projects, Initiatives, Domains. Schedule is the bottom of the funnel: it
// grooms for the day itself. These strings match `Rung` in AppShell so the
// Spine can pass its rung id straight through.
export type Floor = "day" | "project" | "initiative" | "domain";
export const FLOORS: Floor[] = ["day", "project", "initiative", "domain"];

/** A floor is calm (quiet, no cue) at or above this readiness with no exception. */
export const CALM = 0.85;

/** Human label per floor, for "now what" headers. */
export const FLOOR_LABEL: Record<Floor, string> = {
  day: "This week",
  project: "Projects",
  initiative: "Initiatives",
  domain: "Domains",
};

// Week readiness knobs (see docs §8 — tune against the running app).
const WEEK_UNPLANNED = 0.15; // not composed yet → low, but the bar isn't empty
const WEEK_COMPOSED_BASE = 0.4; // composed earns this; attribution earns the rest

// ── The per-item settled score — the one knob that makes calm reachable ──────
/** 0..1 readiness of a single open item, soundness-aware. Unlike `tendedScore`
 *  (which returns 0 for a parked item and would drag a floor DOWN), a `resting`
 *  item is settled BY CHOICE → 1. That sign is the whole difference between
 *  calm-is-reachable and the deficit trap. */
export function settledScore(
  d: VerticalData,
  kind: "project" | "initiative",
  item: Project | Initiative,
): number {
  const stage =
    kind === "project"
      ? ripenessOfProject(d, item as Project).stage
      : ripenessOfInitiative(d, item as Initiative).stage;
  if (stage === "resting") return 1; // parked on purpose = settled, not debt
  return effectiveScore(d, kind, item) ?? 1;
}

/** Mean of a floor's settled scores; an empty floor is fully ready (nothing to
 *  ready = ready), so it never reads as a deficit. */
function mean(scores: number[]): number {
  if (scores.length === 0) return 1;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ── Per-floor readiness (0..1) — "ready for the floor below" ──────────────────
/** Projects ready = tasks sized with a finish line, so the week can take them. */
export function readinessOfProjectFloor(d: VerticalData): number {
  return mean(
    d.projects.filter((p) => isOpenStatus(p.status)).map((p) => settledScore(d, "project", p)),
  );
}

/** Initiatives ready = projects defined enough to run. */
export function readinessOfInitiativeFloor(d: VerticalData): number {
  return mean(
    d.initiatives.filter((i) => isOpenStatus(i.status)).map((i) => settledScore(d, "initiative", i)),
  );
}

/** The floor's shaped/groomed factor recomputed as if `readyIds` were fully
 *  groomed — the projection behind "groom this → Readiness 25→38". */
export function projectedFloorShaped(
  d: VerticalData,
  kind: "project" | "initiative",
  readyIds: Set<string>,
): number {
  const items =
    kind === "project"
      ? d.projects.filter((p) => isOpenStatus(p.status))
      : d.initiatives.filter((i) => isOpenStatus(i.status));
  return mean(items.map((it) => (readyIds.has(it.id) ? 1 : settledScore(d, kind, it))));
}

/** One domain's STRUCTURAL readiness = its open bets (+ loose projects) settled.
 *  Presence (did you spend time there) is a separate axis — it drives the
 *  cue and the domain lamp, never this meter. */
export function readinessOfDomain(d: VerticalData, domainId: string): number {
  const inits = initiativesOf(d, domainId)
    .filter((i) => isOpenStatus(i.status))
    .map((i) => settledScore(d, "initiative", i));
  const loose = looseProjectsOf(d, domainId)
    .filter((p) => isOpenStatus(p.status))
    .map((p) => settledScore(d, "project", p));
  return mean([...inits, ...loose]);
}

/** A domain is "clear" once it's been refined — it carries the routing context
 *  (charter → entities/boundary) the agent uses to file captures here, and
 *  benefits from forever. Unlike presence (an ongoing "did you show up?"),
 *  clarity is a ONE-TIME investment: a refined domain stays clear. */
export function isDomainClear(dom: Domain): boolean {
  return dom.context != null;
}

/** The Domain floor meter = how much of the life map Nuvo can actually route —
 *  the share of domains that have been refined. Not presence (that's the
 *  domain lamp): a one-time clarity that, once earned, holds. */
export function readinessOfDomainFloor(d: VerticalData): number {
  if (!d.domains.length) return 1;
  return d.domains.filter(isDomainClear).length / d.domains.length;
}

/** The Week is ready when it's groomed for *execution*: decided, priorities
 *  named, inbox processed, every committed task given a day. The meter is the
 *  fraction of that checklist satisfied (see `weekReadiness`) — the same source
 *  the spine cue and the "This week" panel read, so they can never diverge.
 *  Domain routing is an up-flow/Tending concern surfaced on Projects/Domains —
 *  deliberately NOT a gate here (it never let the week read calm). */
export function readinessOfWeek(d: VerticalData): number {
  const items = weekReadiness(d);
  const composed = items.find((i) => i.key === "planned")?.done ?? false;
  if (!composed) return WEEK_UNPLANNED;
  const done = items.filter((i) => i.done).length;
  return WEEK_COMPOSED_BASE + (1 - WEEK_COMPOSED_BASE) * (done / items.length);
}

/** Readiness of any floor, by its rung id. (Today is not a readiness floor —
 *  see the `Floor` note: it's the execution surface, not a groomed elevation.) */
export function floorReadiness(d: VerticalData, floor: Floor): number {
  switch (floor) {
    case "day":
      return readinessOfWeek(d);
    case "project":
      return readinessOfProjectFloor(d);
    case "initiative":
      return readinessOfInitiativeFloor(d);
    case "domain":
      return readinessOfDomainFloor(d);
  }
}

// ── Cues — the ONE thing slipping, in the gentle voice ───────────────────────
// Decoupled from the meter: the meter is ambient state, the cue is the single
// highest-priority exception. Most floors, most of the time, have no cue.
export type CueTone =
  | "invite" // an opportunity (window open) — accent
  | "attention" // needs readying — the caution amber
  | "drift"; // quietly slipping — faint

export interface FloorCue {
  tone: CueTone;
  /** short, opportunity-framed — "3 to ready", never "3 incomplete". */
  label: string;
}

/** Project / initiative cue from the two failure modes Tending already flags:
 *  silent (in-flight, undated, gone quiet) first — the "at risk of not being
 *  fulfilled" read — then raw (named, no outcome yet). */
function groomCue(silent: GroomCandidate[], raw: GroomCandidate[], kind: "project" | "initiative"): FloorCue | null {
  const s = silent.filter((c) => c.kind === kind).length;
  if (s) return { tone: "drift", label: `${s} drifting` };
  const r = raw.filter((c) => c.kind === kind).length;
  if (r) return { tone: "attention", label: `${r} to ready` };
  return null;
}

/** Domain cue = a life area Nuvo can't yet route — unrefined, no charter/context.
 *  A one-time clarity nudge ("refine this and grooming gets it forever"), not the
 *  presence nag the domain lamp already carries. */
function domainCue(d: VerticalData): FloorCue | null {
  const unclear = d.domains.filter((dom) => !isDomainClear(dom));
  if (!unclear.length) return null;
  return {
    tone: "attention",
    label: unclear.length === 1 ? `${unclear[0].name} to groom` : `${unclear.length} to groom`,
  };
}

// ── Week readiness — the inspectable checklist behind the Schedule rung ───────
// The "what's between me and a calm week" inventory the Schedule cue summarizes
// and the "This week" panel renders in full. One ordered list, four execution
// gaps; the cue is just its first unfinished line, the meter its fill fraction.
// Scoped to *placement/execution* — domain routing (up-flow) lives elsewhere.
export type WeekReadinessKey = "planned" | "priorities" | "inbox" | "placed";

export interface WeekReadinessItem {
  key: WeekReadinessKey;
  /** the panel line — present-tense, opportunity-framed. */
  label: string;
  /** the short remaining hint when unfinished ("1 to place"), else null. */
  detail: string | null;
  done: boolean;
  /** remaining count for count-based items (0 otherwise). */
  count: number;
}

/** The week's grooming checklist, in priority order. Pure over the snapshot. */
export function weekReadiness(d: VerticalData): WeekReadinessItem[] {
  const composed = Boolean(d.sprint?.reviewed_at);
  // "priorities named" = projects On Deck committed to this week (derived), not
  // the stored snapshot — otherwise this reads green off a list that drifted.
  const rocks = projectsOnDeck(d, d.sprint?.week_start ?? planningWeekStartISO()).length;
  // The week is judged on the plan you made, not on what landed after you made it —
  // a Wednesday capture is not Sunday's debt. Until the week is composed there's no
  // plan to be true to, so the whole pile counts.
  const composedAt = d.sprint?.reviewed_at ?? null;
  const inbox = inboxTasks(d).filter(
    (t) => !composedAt || !t.createdAt || t.createdAt < composedAt,
  ).length;
  // placed = committed this week but with no day yet. A do_date OR a slot (which
  // carries the day) counts as placed; status is "scheduled" once a start_time
  // or slot_id exists, so "ready" = no block and no day.
  const toPlace = sprintTasks(d).filter(
    (t) => t.status === "ready" && !t.doDate && !t.slotId,
  ).length;
  return [
    { key: "planned", label: "Week planned", detail: composed ? null : "plan the week", done: composed, count: 0 },
    { key: "priorities", label: "Priorities named", detail: rocks ? null : "name what matters", done: rocks > 0, count: 0 },
    { key: "inbox", label: "Inbox processed", detail: inbox ? `${inbox} to sort` : null, done: inbox === 0, count: inbox },
    { key: "placed", label: "Every task has a day", detail: toPlace ? `${toPlace} to place` : null, done: toPlace === 0, count: toPlace },
  ];
}

/** Week cue: the single highest-priority unfinished grooming step — the first
 *  gap in `weekReadiness`. The unplanned week reads as an invitation; anything
 *  after it is a gentle attention nudge. Calm when the whole checklist is done. */
function weekCue(d: VerticalData): FloorCue | null {
  const items = weekReadiness(d);
  if (!items[0].done) return { tone: "invite", label: "plan the week" };
  const next = items.find((i) => !i.done);
  if (!next) return null;
  return { tone: "attention", label: next.detail ?? next.label };
}

// ── The spine state — one pass, what the rail renders ────────────────────────
export interface FloorState {
  floor: Floor;
  /** 0..1 — the meter fill. */
  readiness: number;
  /** the single exception worth surfacing, or null when this floor is quiet. */
  cue: FloorCue | null;
  /** quiet rendering: ready enough AND nothing slipping. */
  calm: boolean;
}

export interface SpineState {
  floors: Record<Floor, FloorState>;
  /** every floor calm — the reward state worth designing for. */
  allAtRest: boolean;
}

/** Read the whole spine in one pass — readiness + the one cue per readiness
 *  floor, plus the all-at-rest reward flag. Today (the "now" rung) is excluded:
 *  it's the execution surface, not a groomed floor, so it carries no gauge. The
 *  Spine calls this once per render. */
export function readSpine(d: VerticalData): SpineState {
  const reading = readTending(d);
  const cueFor = (floor: Floor): FloorCue | null => {
    switch (floor) {
      case "day":
        return weekCue(d);
      case "project":
        return groomCue(reading.silent, reading.raw, "project");
      case "initiative":
        return groomCue(reading.silent, reading.raw, "initiative");
      case "domain":
        return domainCue(d);
    }
  };
  const build = (floor: Floor): FloorState => {
    const readiness = floorReadiness(d, floor);
    const cue = cueFor(floor);
    return { floor, readiness, cue, calm: readiness >= CALM && cue == null };
  };
  const floors: Record<Floor, FloorState> = {
    day: build("day"),
    project: build("project"),
    initiative: build("initiative"),
    domain: build("domain"),
  };
  return { floors, allAtRest: FLOORS.every((f) => floors[f].calm) };
}

// ── The single most valuable next turn across the funnel ─────────────────────
// The cross-floor pick a "now what" header surfaces when it isn't tied to one
// altitude (the mobile Now banner, the desktop Today banner): an invitation
// (plan the week) outranks something that needs readying, which outranks drift;
// within a tone, the week comes before the vertical floors. Null = all calm.
const TURN_ORDER: Floor[] = ["day", "project", "initiative", "domain"];
export function topTurn(spine: SpineState): FloorState | null {
  const states = TURN_ORDER.map((f) => spine.floors[f]);
  return (
    states.find((s) => s.cue?.tone === "invite") ??
    states.find((s) => s.cue?.tone === "attention") ??
    states.find((s) => s.cue) ??
    null
  );
}
