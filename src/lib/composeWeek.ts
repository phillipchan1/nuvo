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
import { domainById, initiativeById, projectById, type VerticalData } from "./vertical";
import { toBusyBlocks } from "./now";
import { priorityWork, priorityVerdict, type PriorityVerdict } from "./priorities";
import { seedFromWeek, satelliteAngles, type EmblemSpec } from "./weekEmblem";
import type { BigRock, ExternalEvent, Task } from "./types";

export interface WeekPriority {
  rock: BigRock;
  verdict: PriorityVerdict;
  done: number;
  total: number;
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
}

export interface ComposeWeekInput {
  weekStartISO: string; // Monday of the week
  now: Date;
  vertical: VerticalData;
  events: ExternalEvent[]; // external events intersecting the week
  blocks: Task[]; // scheduled tasks in the week (start_time set)
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
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];
/** below this, a domain reads as "quiet" — drawn as a faint ember, no sweep. */
const QUIET_HOURS = 0.25;

export function composeWeek(input: ComposeWeekInput): WeekReport {
  const { weekStartISO, now, vertical, events, blocks, workStartMin, workEndMin } = input;
  const workingDays = input.workingDays ?? DEFAULT_WORKING_DAYS;
  const weekStart = parseDateISO(weekStartISO);
  const weekEnd = addDays(weekStart, 7);

  // ── Priorities (named, non-empty rocks) → verdicts + next forward block ────
  const sourceRocks = input.bigRocks ?? vertical.bigRocks;
  const rocks = sourceRocks.filter((r) => r.title.trim().length > 0);
  const priorities: WeekPriority[] = rocks.map((rock) => {
    const work = priorityWork(vertical, rock);
    const nextBlock = blocks
      .filter((t) => t.big_rock_id === rock.id && t.start_time && new Date(t.start_time) >= now)
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())[0];
    return {
      rock,
      verdict: priorityVerdict(rock),
      done: work.done,
      total: work.total,
      label: work.label,
      nextBlock: nextBlock ? { startISO: nextBlock.start_time!, title: nextBlock.title } : null,
    };
  });
  const landedCount = priorities.filter((p) => p.verdict === "landed").length;
  const carryForward = rocks.filter((r) => !r.done_at); // unfinished → seeds Sunday

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

  // ── Highlights — done work that advanced a domain (felt impact) ────────────
  const highlights: WeekHighlight[] = vertical.tasks
    .filter((t) => t.status === "done" && t.completedAt && new Date(t.completedAt) >= weekStart && new Date(t.completedAt) < weekEnd)
    .map((t) => {
      const domId =
        t.domainId ?? projectById(vertical, t.projectId)?.domainId ?? initiativeById(vertical, t.initiativeId)?.domainId ?? null;
      const dom = domainById(vertical, domId);
      return dom ? { title: t.title, domainName: dom.name, domainColor: dom.color, mins: t.durationMins } : null;
    })
    .filter((h): h is WeekHighlight => h !== null)
    .sort((a, b) => b.mins - a.mins)
    .slice(0, 6);

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

  const brief = composeWeekBrief({ priorities, landedCount, domains, capacity, carryForward, now, sealed: !!input.sealed });

  return {
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
  };
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
}: {
  priorities: WeekPriority[];
  landedCount: number;
  domains: WeekDomain[];
  capacity: WeekCapacity;
  carryForward: BigRock[];
  now: Date;
  sealed: boolean;
}): string {
  const parts: string[] = [];
  const total = priorities.length;
  const dominant = domains.find((d) => d.hours > 0) ?? null;

  // The outcome line — priorities are the heart of it.
  if (total === 0) {
    parts.push(
      sealed
        ? "A quiet week — nothing was named. Some weeks are like that, and that's alright."
        : "The week is open — nothing named yet. When you're ready, set what matters most.",
    );
  } else if (landedCount === total) {
    parts.push(`Every one of your ${total} priorities landed. That's a week to be proud of.`);
  } else if (landedCount > 0) {
    parts.push(`${landedCount} of ${total} priorities landed${landedCount >= total - 1 ? " — you came close on the rest" : ""}.`);
  } else if (sealed) {
    parts.push(`None of the ${total} landed this week — but the work moved, and that counts.`);
  } else {
    parts.push(`${total} priorit${total === 1 ? "y is" : "ies are"} still in flight — the week isn't done with you yet.`);
  }

  // Where the hours went — affirming, never an audit.
  if (dominant && dominant.hours > 0) {
    parts.push(`Most of your hours went to ${dominant.name} — ${fmtHours(dominant.hours * 60)}h of real attention.`);
  }
  if (!sealed && capacity.openMins > 0 && capacity.workMins > 0) {
    const openH = fmtHours(capacity.openMins);
    parts.push(`There's still ${openH}h of open room ahead.`);
  }

  // Forward-folding — what carries (a gentle invitation; carry is yours to make).
  if (carryForward.length > 0) {
    const n = carryForward.length;
    parts.push(`${n} ${n === 1 ? "is" : "are"} still open — carry ${n === 1 ? "it" : "them"} into next week so Sunday doesn't start cold.`);
  }

  void now;
  return parts.join(" ");
}
