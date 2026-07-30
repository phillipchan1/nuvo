// composeWeek — the deterministic core of the Week's Plan / Review. Mirrors
// composeBrief: every number is real (derived from rows), the prose only narrates
// them. No LLM here (the nano voice layer is a later, optional enhancement that
// falls back to this). The emblem spec is computed here so the forming toolbar
// glyph and the floor share one source.
//
// SCOPE: this reads the *current* week from the live vertical (domain hours are
// already derived live as `investedThisWeek`, priority verdicts from the live
// sprint). Past/sealed weeks render from the stored spec + prose (see storage,
// step 5) — not by recomputing this against stale live data.

import { addDays } from "date-fns";
import { parseDateISO, fmtHours } from "./dates";
import { type VerticalData } from "./vertical";
import { toBusyBlocks } from "./now";
import { priorityWork, priorityVerdict, pushAsRock, weekPlacement, weekPushes, type PriorityVerdict } from "./priorities";
import { lensGaps } from "./lenses";
import { isCompleteStatus } from "../../supabase/functions/_shared/planningRules.ts";
import { seedFromWeek, satelliteAngles, type EmblemSpec } from "./weekEmblem";
import { buildWeekEvidence, type WeekEvidence } from "./weekEvidence";
import { composeWeekFinds, type WeekFind } from "./weekFinds";
import type { ActivityUnit, BigRock, ExternalEvent, Slot, Task } from "./types";

/** One row on the week: the project committed to it, joined to its verdict.
 *
 *  On a LIVE week these are derived from `weekPushes` (the On Deck spans), so
 *  the floor, the rail crown and the board can never disagree about what is on
 *  the week. On a SEALED week they come from that week's stored snapshot and are
 *  never re-derived — the snapshot IS what you committed to back then. */
export interface WeekPriority {
  rock: BigRock;
  /** null only on a legacy sealed rock that was never project-bound. */
  projectId: string | null;
  name: string;
  /** what done looks like — the project's outcome line. */
  outcome: string;
  domainColor: string;
  /** groomed enough to work on — `lensGaps` is empty. */
  ready: boolean;
  /** "no outcome · no steps" — what it's missing, when it isn't ready. */
  gapLabel: string | null;
  verdict: PriorityVerdict;
  /** the project shipped INSIDE this week — the loudest verdict there is. */
  shipped: boolean;
  done: number;
  total: number;
  /** Live weeks only: how much of the remaining work has a time THIS week, and
   *  how much is loose. Both 0 on a sealed week — the row hides the line. */
  placedMins: number;
  looseMins: number;
  label: string | null;
  /** the next future time-block serving this priority, if any (forward hook). */
  nextBlock: { startISO: string; title: string } | null;
}

export interface WeekDomain {
  id: string;
  name: string;
  color: string;
  hours: number; // invested this week
  target: number; // weekly target
  quiet: boolean; // not faithful this week → drawn as an ember (picture-only)
}

export interface WeekCapacity {
  busyMins: number; // committed minutes inside the work window, across working days
  openMins: number; // still-open minutes inside the work window
  workMins: number; // total work-window minutes across working days
}

/** A completed task that advanced a domain — the felt-impact highlights. */
export interface WeekHighlight {
  title: string;
  domainName: string;
  domainColor: string;
  mins: number;
}

export interface WeekReport {
  weekStartISO: string;
  emblem: EmblemSpec;
  priorities: WeekPriority[];
  domains: WeekDomain[];
  capacity: WeekCapacity;
  /** completed work that moved a domain — the felt-impact highlights. */
  highlights: WeekHighlight[];
  /** unfinished priorities (open + carried) → pre-seed Sunday (forward-folding). */
  carryForward: BigRock[];
  landedCount: number;
  priorityTotal: number;
  /** the deterministic warm paragraph — the fallback the nano voice later replaces. */
  brief: string;
  /** Canonical receipts behind domain hours — one ledger for weave + Find. */
  evidence: WeekEvidence;
  /** The one evidence-backed discovery for this week (null when nothing notable). */
  find: WeekFind | null;
}

export interface ComposeWeekInput {
  weekStartISO: string; // Monday of the week
  now: Date;
  vertical: VerticalData;
  events: ExternalEvent[]; // external events intersecting the week
  blocks: Task[]; // scheduled tasks in the week (start_time set)
  /** Slots starting inside the week — their children hold a time the blocks
   *  query can't see (slot children carry `start_time: null`). */
  slots?: Slot[];
  workStartMin: number; // e.g. 480
  workEndMin: number; // e.g. 990
  hiddenCalendarIds?: string[];
  /** Stable keys of individually hidden events — excluded from the busy math. */
  hiddenEventKeys?: string[];
  /** 0=Sun…6=Sat; defaults to Mon–Fri. Non-working days hold no work window. */
  workingDays?: number[];
  // ── past-week overrides (sealed Review) — when omitted, the current week is
  //    read live from `vertical`. A sealed week supplies its own snapshot. ──────
  /** the priorities that were named that week (that week's sprint.big_rocks). */
  bigRocks?: BigRock[];
  /** per-domain invested hours for that week (from `Domain.weeks`). */
  domainHours?: Record<string, number>;
  /** ambient done-count for that week (sealed). */
  ambient?: number;
  /** a past, closed week — shifts the prose to past tense (the Review register). */
  sealed?: boolean;
  /** Calendar → domain map + AI routing cache — for event receipts. */
  calendarDomainMap?: Record<string, string>;
  eventRouting?: Record<string, string>;
  /** Merged PRs / activity actuals in the week window. */
  activityUnits?: ActivityUnit[];
  /** How many whole weeks before the current week (0 = current). */
  weeksBack?: number;
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];
/** below this, a domain reads as "quiet" — drawn as a faint ember, no sweep. */
const QUIET_HOURS = 0.25;

export function composeWeek(input: ComposeWeekInput): WeekReport {
  const { weekStartISO, now, vertical, events, blocks, workStartMin, workEndMin } = input;
  const workingDays = input.workingDays ?? DEFAULT_WORKING_DAYS;
  const weekStart = parseDateISO(weekStartISO);
  const weekEnd = addDays(weekStart, 7);

  // ── The week's projects → verdicts, placement, next forward block ──────────
  // The fork that keeps history honest: a sealed week supplies its own rocks and
  // is rendered from them verbatim (re-deriving would rewrite what you actually
  // committed to back then — priorities.ts:47-50). A live week derives the slate
  // from the On Deck spans, exactly like the rail crown and Sunday do.
  const fromSnapshot = input.bigRocks != null;

  /** The next future block serving this row — matched by rock OR project, since
   *  a derived row has no `big_rock_id` on its tasks to match against. */
  const nextBlockFor = (rockId: string, projectId: string | null) => {
    const b = blocks
      .filter(
        (t) =>
          (t.big_rock_id === rockId || (projectId != null && t.project_id === projectId)) &&
          t.start_time &&
          new Date(t.start_time) >= now,
      )
      .sort((a, b2) => new Date(a.start_time!).getTime() - new Date(b2.start_time!).getTime())[0];
    return b ? { startISO: b.start_time!, title: b.title } : null;
  };

  let priorities: WeekPriority[];
  let landedCount: number;
  let carryForward: BigRock[];

  if (fromSnapshot) {
    const rocks = input.bigRocks!.filter((r) => r.title.trim().length > 0);
    priorities = rocks.map((rock) => {
      const work = priorityWork(vertical, rock);
      const proj = rock.project_id ? vertical.projects.find((p) => p.id === rock.project_id) : undefined;
      return {
        rock,
        projectId: rock.project_id ?? null,
        name: rock.title,
        outcome: rock.win,
        // The project may since have been deleted or re-homed — fall back rather
        // than invent a color for a week that's already over.
        domainColor: (proj ? vertical.domains.find((d) => d.id === proj.domainId)?.color : null) ?? "var(--accent)",
        ready: true, // readiness is a *now* question; a sealed week can't act on it
        gapLabel: null,
        verdict: priorityVerdict(rock),
        shipped: false,
        done: work.done,
        total: work.total,
        placedMins: 0,
        looseMins: 0,
        label: work.label,
        nextBlock: null,
      };
    });
    landedCount = priorities.filter((p) => p.verdict === "landed").length;
    carryForward = rocks.filter((r) => !r.done_at);
  } else {
    const weekBlockTaskIds = new Set(blocks.filter((t) => t.start_time).map((t) => t.id));
    const weekSlotIds = new Set((input.slots ?? []).map((s) => s.id));
    const pushes = weekPushes(vertical, weekStartISO);
    priorities = pushes.map(({ project, rock, done, shipped }) => {
      const asRock = pushAsRock({ project, rock, done, shipped });
      const work = priorityWork(vertical, asRock);
      const placement = weekPlacement(work, weekBlockTaskIds, weekSlotIds);
      const gaps = lensGaps(vertical, "project", project, now);
      return {
        rock: asRock,
        projectId: project.id,
        name: project.name,
        outcome: project.outcome ?? "",
        domainColor: vertical.domains.find((d) => d.id === project.domainId)?.color ?? "var(--accent)",
        ready: gaps.length === 0,
        gapLabel: gaps.length > 0 ? gaps.map((g) => g.label).join(" · ") : null,
        verdict: priorityVerdict(asRock),
        shipped,
        done: work.done,
        total: work.total,
        placedMins: placement.placedMins,
        looseMins: placement.looseMins,
        label: work.label,
        nextBlock: nextBlockFor(asRock.id, project.id),
      };
    });
    // `done` folds in "shipped inside this week" — finishing your biggest thing
    // must count on the scoreboard, not erase it from the week.
    landedCount = pushes.filter((p) => p.done).length;
    carryForward = pushes.filter((p) => !p.done).map(pushAsRock);
  }

  // ── Domains → hours weave + quiet flag (hours-based, so it works for past
  //    weeks too: a domain with no real hours that week reads as an ember). ─────
  const domains: WeekDomain[] = vertical.domains
    .map((d) => {
      const hours = input.domainHours ? input.domainHours[d.id] ?? 0 : d.investedThisWeek;
      return {
        id: d.id,
        name: d.name,
        color: d.color,
        hours,
        target: d.weeklyTargetHours,
        quiet: hours < QUIET_HOURS,
      };
    })
    .sort((a, b) => b.hours - a.hours);

  // ── Capacity across the working days (reuse the one "what's busy" rule) ────
  const busy = toBusyBlocks(events, blocks, input.hiddenCalendarIds ?? [], input.hiddenEventKeys ?? []);
  let busyMins = 0;
  let workMins = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    if (!workingDays.includes(day.getDay())) continue;
    const winStart = new Date(day);
    winStart.setHours(0, workStartMin, 0, 0);
    const winEnd = new Date(day);
    winEnd.setHours(0, workEndMin, 0, 0);
    workMins += Math.max(0, (winEnd.getTime() - winStart.getTime()) / 60_000);
    for (const b of busy) {
      const s = Math.max(b.start.getTime(), winStart.getTime());
      const e = Math.min(b.end.getTime(), winEnd.getTime());
      if (e > s) busyMins += (e - s) / 60_000;
    }
  }
  busyMins = Math.round(busyMins);
  workMins = Math.round(workMins);
  const capacity: WeekCapacity = { busyMins, openMins: Math.max(0, workMins - busyMins), workMins };

  // ── Ambient done-count this week (faint dots) ──────────────────────────────
  const ambient =
    input.ambient ??
    vertical.tasks.filter((t) => {
      if (t.status !== "done" || !t.completedAt) return false;
      const c = new Date(t.completedAt);
      return c >= weekStart && c < weekEnd;
    }).length;

  // ── Evidence ledger (tasks + meetings + activity) — one attribution rule ───
  const evidence = buildWeekEvidence({
    weekStartISO,
    now,
    vertical,
    events,
    calendarDomainMap: input.calendarDomainMap,
    eventRouting: input.eventRouting,
    activityUnits: input.activityUnits,
    weeksBack: input.weeksBack ?? 0,
    domainHoursOverride: input.domainHours,
  });

  // ── Highlights — top task receipts that advanced a domain (felt impact) ────
  const highlights: WeekHighlight[] = evidence.receipts
    .filter((r) => r.kind === "task")
    .slice(0, 6)
    .map((r) => ({ title: r.label, domainName: r.domainName, domainColor: r.domainColor, mins: r.mins }));

  // Prefer evidence-derived hours for the live week so weave matches receipts.
  // Sealed weeks keep the pulse override already applied in `domains` above.
  if (!input.domainHours) {
    for (const d of domains) {
      const ev = evidence.domains.find((e) => e.domainId === d.id);
      if (ev) {
        d.hours = ev.mins / 60;
        d.quiet = d.hours < QUIET_HOURS;
      }
    }
    domains.sort((a, b) => b.hours - a.hours);
  }

  // ── The emblem spec — ~30 numbers, all derived above ───────────────────────
  const seed = seedFromWeek(weekStartISO);
  const maxHours = Math.max(1, ...domains.map((d) => Math.max(d.hours, d.target)));
  const totalHours = domains.reduce((s, d) => s + d.hours, 0);
  const dominant = domains[0] ?? null;
  const angles = satelliteAngles(priorities.length, seed);
  const emblem: EmblemSpec = {
    sun: {
      color: dominant?.color ?? "var(--accent)",
      intensity: totalHours > 0 && dominant ? dominant.hours / totalHours : 0,
    },
    rings: domains.map((d) => ({
      color: d.color,
      sweep: d.quiet ? 0 : Math.min(1, d.hours / maxHours),
      targetSweep: Math.min(1, d.target / maxHours),
      ember: d.quiet,
    })),
    satellites: priorities.map((p, i) => ({ state: p.verdict, angle: angles[i] ?? 0 })),
    ambient,
    seed,
  };

  const brief = composeWeekBrief({
    priorities,
    landedCount,
    domains,
    capacity,
    carryForward,
    now,
    sealed: !!input.sealed,
    // Day one has no projects at all — a different sentence from "you have
    // projects, none are on this week" (P7/P16: honest in a stranger's account).
    hasAnyOpenProject: vertical.projects.some((p) => !isCompleteStatus(p.status)),
  });

  const reportBase = {
    weekStartISO,
    emblem,
    priorities,
    domains,
    capacity,
    highlights,
    carryForward,
    landedCount,
    priorityTotal: priorities.length,
    brief,
    evidence,
  };
  const findReport = composeWeekFinds({
    report: { ...reportBase, find: null },
    evidence,
    vertical,
    sealed: !!input.sealed,
  });

  return { ...reportBase, find: findReport.featured };
}

/**
 * The warm, deterministic paragraph — the Review's "wise friend" register, but
 * with every number real (the nano voice layer later replaces this, and falls
 * back to it). Gentle-steward: a quiet domain is never scolded here (that's the
 * ember's job, picture-only); the prose stays affirming and forward-folding.
 */
function composeWeekBrief({
  priorities,
  landedCount,
  domains,
  capacity,
  carryForward,
  now,
  sealed,
  hasAnyOpenProject,
}: {
  priorities: WeekPriority[];
  landedCount: number;
  domains: WeekDomain[];
  capacity: WeekCapacity;
  carryForward: BigRock[];
  now: Date;
  sealed: boolean;
  hasAnyOpenProject: boolean;
}): string {
  const parts: string[] = [];
  const total = priorities.length;
  const dominant = domains.find((d) => d.hours > 0) ?? null;

  // The outcome line — the week's projects are the heart of it.
  if (total === 0) {
    parts.push(
      sealed
        ? "A quiet week — nothing was on it. Some weeks are like that, and that's alright."
        : hasAnyOpenProject
          ? "Nothing's on this week yet. Bring a project in and the week has a shape."
          : "No projects yet — the week is genuinely empty, and that's a fine place to start.",
    );
  } else if (landedCount === total) {
    parts.push(`Every one of your ${total} projects landed. That's a week to be proud of.`);
  } else if (landedCount > 0) {
    parts.push(`${landedCount} of ${total} landed${landedCount >= total - 1 ? " — you came close on the rest" : ""}.`);
  } else if (sealed) {
    parts.push(`None of the ${total} landed this week — but the work moved, and that counts.`);
  } else {
    parts.push(`${total} project${total === 1 ? " is" : "s are"} still in flight — the week isn't done with you yet.`);
  }

  // Where the hours went — affirming, never an audit.
  if (dominant && dominant.hours > 0) {
    parts.push(`Most of your hours went to ${dominant.name} — ${fmtHours(dominant.hours * 60)}h of real attention.`);
  }
  if (!sealed && capacity.openMins > 0 && capacity.workMins > 0) {
    const openH = fmtHours(capacity.openMins);
    parts.push(`There's still ${openH}h of open room ahead.`);
  }

  // Forward-folding — what's still open, and where the act to resolve it lives.
  // (It used to invite a "carry" that wrote into next week's big_rocks, which
  // nothing reads; the real act is a span write, and it's on the row.)
  if (carryForward.length > 0) {
    const n = carryForward.length;
    parts.push(
      sealed
        ? `${n} ${n === 1 ? "was" : "were"} still open when the week closed.`
        : `${n} still open — each one can take another week or move out, on its row.`,
    );
  }

  void now;
  return parts.join(" ");
}
