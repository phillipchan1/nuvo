// Tending — the grooming layer. Reads how *ripe* each project / initiative is
// (raw → shaped → scaffolded → active) from cheap one-line checks, finds the
// few that most warrant grooming now, and flags the two failure modes (raw and
// silent items). Pure over a VerticalData snapshot, exactly like standback.ts —
// no AI to SCORE; the assistant only ADVANCES. Scoring lives here so the pip can
// read it everywhere and the Tending ritual can build its queue from one source.

import { differenceInCalendarDays } from "date-fns";
import { parseDateISO, todayISO } from "./dates";
import {
  isOpenStatus,
  isProjectComplete,
  isProjectInFlight,
  looseTasksOfInitiative,
  projectsOf,
  tasksOf,
  type Initiative,
  type Project,
  type VerticalData,
  type VTask,
} from "./vertical";

// ── The ripeness ladder ──────────────────────────────────────────────────────
export type Ripeness = "raw" | "shaped" | "scaffolded" | "active" | "resting";

export interface RipenessRead {
  stage: Ripeness;
  /** 0..3 along the ladder; resting is off-ladder (-1). */
  score: number;
}

const RAW: RipenessRead = { stage: "raw", score: 0 };
const SHAPED: RipenessRead = { stage: "shaped", score: 1 };
const SCAFFOLDED: RipenessRead = { stage: "scaffolded", score: 2 };
const ACTIVE: RipenessRead = { stage: "active", score: 3 };
const RESTING: RipenessRead = { stage: "resting", score: -1 };

export const RIPENESS_LABEL: Record<Ripeness, string> = {
  raw: "Raw",
  shaped: "Shaped",
  scaffolded: "Scaffolded",
  active: "Active",
  resting: "Resting",
};

export const RIPENESS_HINT: Record<Ripeness, string> = {
  raw: "Has a name, but no outcome yet",
  shaped: "Outcome set — needs an ordered path",
  scaffolded: "Has a next action — needs a finish line",
  active: "Has a finish line and is moving",
  resting: "Parked — resting until you return to it",
};

/** What each non-active stage needs next — the "advance" the ritual offers. */
export const RIPENESS_ADVANCE: Record<Ripeness, string> = {
  raw: "Draft the outcome",
  shaped: "Scaffold an ordered path",
  scaffolded: "Set a finish line · pull to the week",
  active: "Handed to the time layer",
  resting: "Resting",
};

const SILENT_DAYS = 14;
const RECENTLY_TENDED_DAYS = 7;
const RECENTLY_CREATED_DAYS = 10;

// ── A task carries a "time commitment" once it's on the week or the calendar ──
function hasTimeCommitment(t: VTask): boolean {
  return t.status === "scheduled" || Boolean(t.sprint) || Boolean(t.doDate);
}

// ── Score a single item ──────────────────────────────────────────────────────
export function ripenessOfProject(d: VerticalData, p: Project): RipenessRead {
  if (p.status === "waiting") return RESTING; // parked → out of the ladder
  if (isProjectComplete(p.status)) return ACTIVE; // shipped reads fully ripe
  if (!p.outcome.trim()) return RAW;
  const open = tasksOf(d, p.id).filter((t) => t.status !== "done");
  if (open.length === 0) return SHAPED;
  if (p.targetDate || open.some(hasTimeCommitment)) return ACTIVE;
  return SCAFFOLDED;
}

export function ripenessOfInitiative(d: VerticalData, i: Initiative): RipenessRead {
  if (i.status === "waiting") return RESTING;
  if (isProjectComplete(i.status)) return ACTIVE;
  if (!i.outcome.trim()) return RAW;
  const projects = projectsOf(d, i.id);
  const openLoose = looseTasksOfInitiative(d, i.id).filter((t) => t.status !== "done");
  if (projects.length === 0 && openLoose.length === 0) return SHAPED;
  const committed =
    openLoose.some(hasTimeCommitment) ||
    projects.some((pr) =>
      tasksOf(d, pr.id).some((t) => t.status !== "done" && hasTimeCommitment(t)),
    );
  if (i.targetDate || committed) return ACTIVE;
  return SCAFFOLDED;
}

// ── Per-item "last touched" — the silent / faithfulness signal ───────────────
function lastDoneAt(tasks: VTask[]): number | null {
  let last: number | null = null;
  for (const t of tasks) {
    if (t.status === "done" && t.completedAt) {
      const at = new Date(t.completedAt).getTime();
      if (last == null || at > last) last = at;
    }
  }
  return last;
}

function daysSince(ms: number | null, now: Date): number | null {
  if (ms == null) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
}

function daysSinceISO(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

// ── A candidate the ritual can groom ─────────────────────────────────────────
export interface GroomCandidate {
  kind: "project" | "initiative";
  id: string;
  name: string;
  domainId: string;
  ripeness: RipenessRead;
  /** why it surfaced — short badges for the Reading. */
  reasons: string[];
  /** ranking weight (higher = groom sooner). */
  priority: number;
  /** active-but-stale, undated — the "silent" failure mode. */
  silent: boolean;
  daysSinceTouch: number | null;
}

export interface TendingRead {
  /** the ripest-few (~limit) most worth grooming now. */
  queue: GroomCandidate[];
  /** active in-flight items that have gone quiet and undated. */
  silent: GroomCandidate[];
  /** items with a name but no outcome — the raw failure mode. */
  raw: GroomCandidate[];
  /** 0..100 portfolio readiness — the meter the Yield animates. */
  readiness: number;
}

function buildCandidate(
  d: VerticalData,
  kind: "project" | "initiative",
  item: Project | Initiative,
  now: Date,
): GroomCandidate {
  const ripeness = kind === "project"
    ? ripenessOfProject(d, item as Project)
    : ripenessOfInitiative(d, item as Initiative);

  const tasks = kind === "project"
    ? tasksOf(d, item.id)
    : [...looseTasksOfInitiative(d, item.id), ...projectsOf(d, item.id).flatMap((p) => tasksOf(d, p.id))];
  const daysSinceTouch = daysSince(lastDoneAt(tasks), now);

  const inFlight = isProjectInFlight(item.status);
  const silent =
    inFlight && !item.targetDate && (daysSinceTouch == null || daysSinceTouch >= SILENT_DAYS);

  // ── ranking: importance prior + imminence + ripeness gap ──────────────────
  const reasons: string[] = [];
  let priority = 0;

  // importance prior — a lead bet (or a project under one)
  const focus = new Set(d.focusInitiativeIds);
  const initiativeId = kind === "initiative" ? item.id : (item as Project).initiativeId;
  if (initiativeId && focus.has(initiativeId)) {
    priority += 40;
    reasons.push("★ lead bet");
  }

  // importance prior — lives in a domain you've tended lately (momentum)
  const domain = d.domains.find((dom) => dom.id === item.domainId);
  if (domain && domain.lastTouchedDays <= 3) {
    priority += 12;
    reasons.push(`in ${domain.name}`);
  }

  // importance prior — recently created (it's on your mind)
  const ageDays = daysSinceISO(item.createdAt, now);
  if (ageDays != null && ageDays <= RECENTLY_CREATED_DAYS) {
    priority += 16;
    reasons.push("new");
  }

  // imminence — a finish line bearing down
  if (item.targetDate) {
    const daysLeft = differenceInCalendarDays(parseDateISO(item.targetDate), parseDateISO(todayISO(now)));
    if (daysLeft < 0) { priority += 35; reasons.push(`${-daysLeft}d overdue`); }
    else if (daysLeft <= 14) { priority += 28 - daysLeft; reasons.push(`${daysLeft}d out`); }
  }

  // the silent flag is itself a reason to surface
  if (silent) {
    priority += 22;
    reasons.push(daysSinceTouch == null ? "untouched" : `quiet ${daysSinceTouch}d`);
  }

  // ripeness gap — how much grooming is left to do (raw needs the most)
  const gap = Math.max(0, 3 - ripeness.score);
  priority += gap * 8;

  return {
    kind,
    id: item.id,
    name: item.name,
    domainId: item.domainId,
    ripeness,
    reasons,
    priority,
    silent,
    daysSinceTouch,
  };
}

/** A candidate is groomable when it's open, not resting, not freshly tended,
 *  and still has a stage to advance (active items are handed to the time layer). */
function isGroomable(c: GroomCandidate, tendedDays: number | null): boolean {
  if (c.ripeness.stage === "resting" || c.ripeness.stage === "active") return false;
  if (tendedDays != null && tendedDays < RECENTLY_TENDED_DAYS) return false;
  return true;
}

export function readTending(d: VerticalData, now: Date = new Date(), limit = 3): TendingRead {
  const candidates: { c: GroomCandidate; tendedDays: number | null }[] = [];

  for (const p of d.projects) {
    if (!isOpenStatus(p.status)) continue;
    candidates.push({ c: buildCandidate(d, "project", p, now), tendedDays: daysSinceISO(p.tendedAt, now) });
  }
  for (const i of d.initiatives) {
    if (!isOpenStatus(i.status)) continue;
    candidates.push({ c: buildCandidate(d, "initiative", i, now), tendedDays: daysSinceISO(i.tendedAt, now) });
  }

  const groomable = candidates
    .filter(({ c, tendedDays }) => isGroomable(c, tendedDays))
    .map(({ c }) => c)
    .sort((a, b) => b.priority - a.priority);

  const queue = groomable.slice(0, limit);
  const queued = new Set(queue.map((c) => c.id));

  // the two failure modes, flagged separately (may overlap the queue)
  const all = candidates.map(({ c }) => c);
  const silent = all.filter((c) => c.silent && !queued.has(c.id)).sort((a, b) => b.priority - a.priority);
  const raw = all.filter((c) => c.ripeness.stage === "raw" && !queued.has(c.id)).sort((a, b) => b.priority - a.priority);

  return { queue, silent, raw, readiness: portfolioReadiness(d) };
}

/** 0..100 — mean ripeness across open items; the meter the Yield animates up.
 *  Resting items step out of the ladder and don't drag the read down. */
export function portfolioReadiness(d: VerticalData): number {
  const scores: number[] = [];
  const collect = (r: RipenessRead) => {
    if (r.stage === "resting") return;
    scores.push(Math.max(0, r.score) / 3);
  };
  for (const p of d.projects) if (isOpenStatus(p.status) || isProjectComplete(p.status)) collect(ripenessOfProject(d, p));
  for (const i of d.initiatives) if (isOpenStatus(i.status) || isProjectComplete(i.status)) collect(ripenessOfInitiative(d, i));
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 100);
}
