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
import { todayISO } from "./dates";

// ── Floors — the spine's altitudes, by their Rung id ─────────────────────────
// NOTE the legacy naming: "now" is the Today/Day floor, "day" is the Schedule/
// Week floor. These strings match `Rung` in AppShell so the Spine can pass its
// rung id straight through.
export type Floor = "now" | "day" | "project" | "initiative" | "domain";
export const FLOORS: Floor[] = ["now", "day", "project", "initiative", "domain"];

/** A floor is calm (quiet, no cue) at or above this readiness with no exception. */
export const CALM = 0.85;

/** Human label per floor, for "now what" headers. */
export const FLOOR_LABEL: Record<Floor, string> = {
  now: "Today",
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

/** One domain's STRUCTURAL readiness = its open bets (+ loose projects) settled.
 *  Faithfulness (did you spend time there) is a separate axis — it drives the
 *  cue and the chapel lamp, never this meter. */
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
 *  benefits from forever. Unlike faithfulness (an ongoing "did you show up?"),
 *  clarity is a ONE-TIME investment: a refined domain stays clear. */
export function isDomainClear(dom: Domain): boolean {
  return dom.context != null;
}

/** The Domain floor meter = how much of the life map Nuvo can actually route —
 *  the share of domains that have been refined. Not faithfulness (that's the
 *  chapel lamp): a one-time clarity that, once earned, holds. */
export function readinessOfDomainFloor(d: VerticalData): number {
  if (!d.domains.length) return 1;
  return d.domains.filter(isDomainClear).length / d.domains.length;
}

/** The Week is ready when it's been decided AND every committed task traces to a
 *  domain (loose tasks are the up-flow leak that makes domain balance lie). */
export function readinessOfWeek(d: VerticalData): number {
  const composed = Boolean(d.sprint?.reviewed_at);
  if (!composed) return WEEK_UNPLANNED;
  const open = sprintTasks(d).filter((t) => t.status !== "done");
  const attributed = open.length === 0 ? 1 : open.filter((t) => t.domainId).length / open.length;
  return WEEK_COMPOSED_BASE + (1 - WEEK_COMPOSED_BASE) * attributed;
}

/** The Day is ready when today's commitments are placed, not floating. */
export function readinessOfDay(d: VerticalData, now: Date = new Date()): number {
  const today = todayISO(now);
  const todays = d.tasks.filter((t) => t.doDate === today && t.status !== "done");
  if (todays.length === 0) return 1;
  const placed = todays.filter((t) => t.status === "scheduled").length;
  return placed / todays.length;
}

/** Readiness of any floor, by its rung id. */
export function floorReadiness(d: VerticalData, floor: Floor, now: Date = new Date()): number {
  switch (floor) {
    case "now":
      return readinessOfDay(d, now);
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
 *  faithfulness nag the chapel lamp already carries. */
function domainCue(d: VerticalData): FloorCue | null {
  const unclear = d.domains.filter((dom) => !isDomainClear(dom));
  if (!unclear.length) return null;
  return {
    tone: "attention",
    label: unclear.length === 1 ? `${unclear[0].name} to refine` : `${unclear.length} to refine`,
  };
}

/** Week cue: the planning invitation, then the loose-task leak. */
function weekCue(d: VerticalData): FloorCue | null {
  if (!d.sprint?.reviewed_at) return { tone: "invite", label: "plan the week" };
  const loose = sprintTasks(d).filter((t) => t.status !== "done" && !t.domainId).length;
  if (loose) return { tone: "attention", label: `${loose} loose this week` };
  return null;
}

/** Day cue: today has commitments still floating — on the day, not yet given a
 *  time. The pure-vertical read of Today (no clock): the coach's live "what
 *  slipped / what's open now" stays inside the Today tab, never the chrome. */
function dayCue(d: VerticalData, now: Date): FloorCue | null {
  const today = todayISO(now);
  const unplaced = d.tasks.filter((t) => t.doDate === today && t.status === "ready").length;
  if (unplaced) return { tone: "drift", label: `${unplaced} to place` };
  return null;
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

/** Read the whole spine in one pass — readiness + the one cue per floor, plus
 *  the all-at-rest reward flag. The Spine calls this once per render. */
export function readSpine(d: VerticalData, now: Date = new Date()): SpineState {
  const reading = readTending(d);
  const cueFor = (floor: Floor): FloorCue | null => {
    switch (floor) {
      case "now":
        return dayCue(d, now);
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
    const readiness = floorReadiness(d, floor, now);
    const cue = cueFor(floor);
    return { floor, readiness, cue, calm: readiness >= CALM && cue == null };
  };
  const floors: Record<Floor, FloorState> = {
    now: build("now"),
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
// within a tone, the week and the vertical come before the day. Null = all calm.
const TURN_ORDER: Floor[] = ["day", "project", "initiative", "domain", "now"];
export function topTurn(spine: SpineState): FloorState | null {
  const states = TURN_ORDER.map((f) => spine.floors[f]);
  return (
    states.find((s) => s.cue?.tone === "invite") ??
    states.find((s) => s.cue?.tone === "attention") ??
    states.find((s) => s.cue) ??
    null
  );
}
