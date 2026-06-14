// The Standback — the strategic sibling of the morning brief. Where brief.ts
// reads *today*, this reads the *board*: the bets in flight, whether any are
// slipping off pace, and which domains have gone quiet. Same philosophy —
// deterministic, instant, no model round-trip — but a step up in altitude and
// time horizon. It answers the operator's standing questions: what are the big
// initiatives, am I behind, did I neglect something I can't put my finger on.
//
// Everything here is pure over a VerticalData snapshot, so the floor that draws
// it never has to know where the numbers came from.

import { differenceInCalendarDays } from "date-fns";
import { parseDateISO, todayISO } from "./dates";
import {
  initiativeProgress,
  projectsOf,
  type Domain,
  type Initiative,
  type VerticalData,
} from "./vertical";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── Trajectory — the answer to "am I behind?" ────────────────────────────────
// We compare two clocks: how far through the *calendar* a bet is (start →
// target) versus how far through the *work* it is (progress). When the calendar
// has run ahead of the work, the bet is drifting; we also project a finish date
// from the pace logged so far and report how many days late that lands.

export type Pace = "ahead" | "on_track" | "at_risk" | "behind" | "untracked";

export interface Trajectory {
  pace: Pace;
  progress: number; // 0..100, where the work actually stands now
  expected: number | null; // 0..100, where the calendar says you'd be — null w/o a start
  daysLeft: number | null; // calendar days to target (negative = past due)
  slipDays: number | null; // projected days late at the pace so far (>0 = late)
  note: string; // one human line
}

export function readTrajectory(
  progress: number,
  startDate: string | null,
  targetDate: string | null,
  now: Date,
): Trajectory {
  const today = parseDateISO(todayISO(now));

  if (progress >= 100) {
    return { pace: "ahead", progress, expected: 100, daysLeft: null, slipDays: null, note: "done — ready to ship" };
  }
  if (!targetDate) {
    return { pace: "untracked", progress, expected: null, daysLeft: null, slipDays: null, note: "no finish line set" };
  }

  const target = parseDateISO(targetDate);
  const daysLeft = differenceInCalendarDays(target, today);

  const start = startDate ? parseDateISO(startDate) : null;
  const total = start ? differenceInCalendarDays(target, start) : null;
  const elapsed = start ? differenceInCalendarDays(today, start) : null;
  const expected = total && total > 0 && elapsed != null ? clamp01(elapsed / total) * 100 : null;

  // velocity in % per day, from the work logged since the bet opened
  const velocity = start && elapsed != null && elapsed > 0 ? progress / elapsed : null;
  const slipDays =
    velocity && velocity > 0 ? Math.round((100 - progress) / velocity - daysLeft) : null;

  // Already past the finish line with work remaining — the loudest signal.
  if (daysLeft < 0) {
    return {
      pace: "behind",
      progress,
      expected,
      daysLeft,
      slipDays,
      note: `past due ${-daysLeft}d · ${Math.round(progress)}% done`,
    };
  }

  let pace: Pace;
  if (expected != null) {
    const delta = progress - expected;
    if (delta <= -25 || (slipDays != null && slipDays >= 14)) pace = "behind";
    else if (delta <= -10 || (slipDays != null && slipDays >= 4)) pace = "at_risk";
    else if (delta >= 12) pace = "ahead";
    else pace = "on_track";
  } else {
    // No start date to draw a curve from — fall back to a coarse runway read.
    if (daysLeft <= 7 && progress < 60) pace = "behind";
    else if (daysLeft <= 14 && progress < 40) pace = "at_risk";
    else pace = "on_track";
  }

  const note =
    pace === "behind" && slipDays != null && slipDays > 0
      ? `~${slipDays}d behind pace · ${daysLeft}d to target`
      : pace === "behind"
        ? `behind pace · ${daysLeft}d to target`
        : pace === "at_risk"
          ? `drifting · ${daysLeft}d to target`
          : pace === "ahead"
            ? `ahead of pace · ${daysLeft}d to target`
            : `on pace · ${daysLeft}d to target`;

  return { pace, progress, expected, daysLeft, slipDays, note };
}

// ── The bets in flight ───────────────────────────────────────────────────────

export interface BetRead {
  initiative: Initiative;
  domain: Domain | null;
  progress: number;
  lastTouchedDays: number | null; // since a task under it was completed; null = never
  trajectory: Trajectory;
  salience: number; // higher = more deserving of your attention right now
}

/** Most recent completion under an initiative (its own tasks + its projects'). */
function initiativeLastTouchedDays(d: VerticalData, init: Initiative, now: Date): number | null {
  const projectIds = new Set(projectsOf(d, init.id).map((p) => p.id));
  let latest = 0;
  for (const t of d.tasks) {
    if (t.status !== "done" || !t.completedAt) continue;
    const under = t.initiativeId === init.id || (t.projectId != null && projectIds.has(t.projectId));
    if (!under) continue;
    const at = new Date(t.completedAt).getTime();
    if (at > latest) latest = at;
  }
  if (latest === 0) return null;
  return Math.max(0, Math.floor((now.getTime() - latest) / 86_400_000));
}

function salienceOf(t: Trajectory, momentum: Initiative["momentum"], lastTouchedDays: number | null): number {
  let s = 0;
  if (t.pace === "behind") s += 4;
  else if (t.pace === "at_risk") s += 2;
  else if (t.pace === "untracked") s += 1;

  if (t.daysLeft != null) {
    if (t.daysLeft <= 7) s += 3;
    else if (t.daysLeft <= 21) s += 2;
    else if (t.daysLeft <= 45) s += 1;
  }

  if (momentum === "down") s += 2;
  if (lastTouchedDays != null && lastTouchedDays >= 7) s += 2;
  else if (lastTouchedDays != null && lastTouchedDays >= 4) s += 1;

  return s;
}

// ── Blind spots — the answer to "did I neglect something?" ───────────────────

export interface BlindSpot {
  domain: Domain;
  reason: "untouched" | "quiet" | "under_target";
  note: string;
}

function blindSpotsOf(domains: Domain[], now: Date): BlindSpot[] {
  const dow = now.getDay(); // 0 Sun … 6 Sat — only nag on weekly targets midweek+
  const out: BlindSpot[] = [];
  for (const d of domains) {
    if (d.lastTouchedDays >= 99) {
      out.push({ domain: d, reason: "untouched", note: "untouched — nothing logged here" });
    } else if (d.lastTouchedDays >= 5) {
      out.push({ domain: d, reason: "quiet", note: `quiet ${d.lastTouchedDays}d` });
    } else if (
      dow >= 3 &&
      d.weeklyTargetHours > 0 &&
      d.investedThisWeek < d.weeklyTargetHours * 0.34
    ) {
      out.push({
        domain: d,
        reason: "under_target",
        note: `${d.investedThisWeek.toFixed(d.investedThisWeek % 1 === 0 ? 0 : 1)}h of ${d.weeklyTargetHours}h this week`,
      });
    }
  }
  return out.sort((a, b) => b.domain.lastTouchedDays - a.domain.lastTouchedDays);
}

// ── The whole read ───────────────────────────────────────────────────────────

export interface StandbackRead {
  bets: BetRead[]; // active bets, salience-sorted (loudest first)
  drifting: BetRead[]; // subset whose pace is behind / at_risk
  blindSpots: BlindSpot[];
  headline: string; // a short prose read of the board
  activeCount: number;
}

export function readStandback(d: VerticalData, now: Date = new Date()): StandbackRead {
  const active = d.initiatives.filter((i) => i.status === "active");

  const bets: BetRead[] = active
    .map((init) => {
      const progress = initiativeProgress(d, init);
      const trajectory = readTrajectory(progress, init.startDate, init.targetDate, now);
      const lastTouchedDays = initiativeLastTouchedDays(d, init, now);
      const domain = d.domains.find((x) => x.id === init.domainId) ?? null;
      return {
        initiative: init,
        domain,
        progress,
        lastTouchedDays,
        trajectory,
        salience: salienceOf(trajectory, init.momentum, lastTouchedDays),
      };
    })
    .sort(
      (a, b) =>
        b.salience - a.salience ||
        (a.trajectory.daysLeft ?? 9999) - (b.trajectory.daysLeft ?? 9999),
    );

  const drifting = bets.filter((b) => b.trajectory.pace === "behind" || b.trajectory.pace === "at_risk");
  const blindSpots = blindSpotsOf(d.domains, now);

  return {
    bets,
    drifting,
    blindSpots,
    headline: composeHeadline(bets, drifting, blindSpots),
    activeCount: active.length,
  };
}

function composeHeadline(bets: BetRead[], drifting: BetRead[], blindSpots: BlindSpot[]): string {
  if (bets.length === 0) {
    return "No active bets in flight — a clear board. A good moment to shape the next one, or to rest.";
  }

  const parts: string[] = [];
  const n = bets.length;
  const behind = drifting.filter((b) => b.trajectory.pace === "behind");

  let lead = `${n} bet${n === 1 ? "" : "s"} in flight`;
  if (behind.length > 0) lead += `, ${behind.length} slipping behind pace`;
  else if (drifting.length > 0) lead += `, ${drifting.length} starting to drift`;
  else lead += `, all holding pace`;
  parts.push(`${lead}.`);

  const spot = blindSpots[0];
  if (spot) {
    parts.push(
      spot.reason === "untouched"
        ? `${spot.domain.name} is untouched — it's the one slipping out of view.`
        : spot.reason === "quiet"
          ? `${spot.domain.name} has gone quiet — ${spot.domain.lastTouchedDays}d since you last tended it.`
          : `${spot.domain.name} is light this week — ${spot.note}.`,
    );
  }

  return parts.join(" ");
}
