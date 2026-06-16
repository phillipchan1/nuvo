// The Standback — the strategic sibling of the morning brief, read in the
// language of Gain, not Gap. Dan Sullivan's measure: you feel progress by
// looking *backward* at how far you've come, not by measuring yourself against
// a receding ideal. So this surface leads with what moved and what it *means* —
// the implications behind the progress, not a tally of finished tasks — and
// holds the horizon lightly, as a compass for where to point next rather than a
// ruler that says you're behind.
//
// Everything here is pure over a VerticalData snapshot. The week-over-week
// deltas reuse initiativeProgressAt(), the same no-snapshot trick the Sunday
// ritual uses, so "the Gain" is real movement, measured against last week's
// actual position.

import { differenceInCalendarDays, startOfWeek } from "date-fns";
import { parseDateISO, todayISO } from "./dates";
import {
  initiativeProgress,
  initiativeProgressAt,
  isProjectInFlight,
  projectsOf,
  tasksOf,
  type Domain,
  type Initiative,
  type VerticalData,
} from "./vertical";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const fmtH = (h: number) => `${h.toFixed(h % 1 === 0 ? 0 : 1)}h`;

// ── The Gain — what moved, and what it means ─────────────────────────────────

export type WinKind = "shipped" | "milestone" | "unblocked" | "advanced" | "kept_faith";

export interface Win {
  id: string;
  kind: WinKind;
  accent: string | null; // the domain's color
  headline: string; // the gain itself — concrete, past tense
  implication: string | null; // the intelligence — what it unlocks or means
  weight: number; // ordering: the most meaningful gain leads
}

const MILESTONES = [50, 75, 100] as const;

function initiativeWins(d: VerticalData, weekStart: Date): Win[] {
  const wins: Win[] = [];
  for (const init of d.initiatives) {
    const now = initiativeProgress(d, init);
    const then = initiativeProgressAt(d, init, weekStart);
    if (now <= then) continue; // only forward motion is a gain
    const domain = d.domains.find((x) => x.id === init.domainId) ?? null;
    const accent = domain?.color ?? null;
    const delta = Math.round(now - then);

    // Reaching the finish line this week is the loudest gain.
    if (now >= 100 && then < 100) {
      wins.push({
        id: `ship-${init.id}`,
        kind: "shipped",
        accent,
        headline: `${init.name} reached the finish line`,
        implication: domain ? `A bet closed — that's ${domain.name} delivered on.` : "A bet closed.",
        weight: 100,
      });
      continue;
    }

    // A milestone crossing carries its own meaning — name it.
    const crossed = [...MILESTONES].reverse().find((m) => m < 100 && then < m && now >= m);
    if (crossed) {
      wins.push({
        id: `mile-${init.id}`,
        kind: "milestone",
        accent,
        headline: `${init.name} crossed ${crossed}%${crossed === 50 ? " — the halfway line" : ""}`,
        implication:
          crossed >= 75
            ? "Into the final stretch — the end is in sight."
            : "Past halfway — the back half tends to move faster.",
        weight: crossed >= 75 ? 80 : 65,
      });
      continue;
    }

    // Plain forward motion still counts — measured against last week, not the goal.
    wins.push({
      id: `adv-${init.id}`,
      kind: "advanced",
      accent,
      headline: `${init.name} moved ${then}% → ${now}%`,
      implication: delta >= 15 ? `A strong week — +${delta} points of real progress.` : null,
      weight: 15 + Math.min(delta, 30),
    });
  }
  return wins;
}

/** A project whose last open task closed this week — it cleared a path. */
function unblockWins(d: VerticalData, weekStart: Date): Win[] {
  const wins: Win[] = [];
  for (const p of d.projects) {
    const ts = tasksOf(d, p.id);
    if (ts.length === 0) continue;
    if (ts.some((t) => t.status !== "done")) continue; // not actually finished
    const finishedAt = ts.reduce((m, t) => Math.max(m, t.completedAt ? new Date(t.completedAt).getTime() : 0), 0);
    if (finishedAt < weekStart.getTime()) continue; // finished earlier, not this week's gain

    const init = p.initiativeId ? d.initiatives.find((i) => i.id === p.initiativeId) ?? null : null;
    const siblingsOpen = init
      ? projectsOf(d, init.id).some((sib) => sib.id !== p.id && sib.status !== "complete" && sib.status !== "cancelled")
      : false;
    const domain = d.domains.find((x) => x.id === p.domainId) ?? null;
    wins.push({
      id: `unblk-${p.id}`,
      kind: "unblocked",
      accent: domain?.color ?? null,
      headline: `${p.name} — done`,
      implication: init
        ? siblingsOpen
          ? `Cleared the way for what's next in ${init.name}.`
          : `The last piece of ${init.name} fell into place.`
        : null,
      weight: 70,
    });
  }
  return wins;
}

/** Domains that kept faith with their weekly vow — fidelity is its own gain. */
function faithWins(domains: Domain[]): Win[] {
  return domains
    .filter((dom) => dom.weeklyTargetHours > 0 && dom.investedThisWeek >= dom.weeklyTargetHours)
    .map((dom) => ({
      id: `faith-${dom.id}`,
      kind: "kept_faith" as const,
      accent: dom.color,
      headline: `${dom.name} — ${fmtH(dom.investedThisWeek)} this week, vow kept`,
      implication: dom.quarterHours >= dom.weeklyTargetHours * 8 ? `${dom.quarterHours}h this quarter — a steady arc.` : null,
      weight: 30,
    }));
}

// ── The compass — the horizon as direction, held lightly ─────────────────────

export type Pace = "ahead" | "on_track" | "needs_pull" | "untracked";

export interface Forward {
  initiative: Initiative;
  domain: Domain | null;
  progress: number;
  daysLeft: number | null;
  pace: Pace;
  line: string; // a calm direction line — never a deficit count
}

function readForward(d: VerticalData, init: Initiative, now: Date): Forward {
  const domain = d.domains.find((x) => x.id === init.domainId) ?? null;
  const progress = initiativeProgress(d, init);
  const today = parseDateISO(todayISO(now));

  if (!init.targetDate) {
    return { initiative: init, domain, progress, daysLeft: null, pace: "untracked", line: "no finish line set — open horizon" };
  }
  const daysLeft = differenceInCalendarDays(parseDateISO(init.targetDate), today);
  const start = init.startDate ? parseDateISO(init.startDate) : null;
  const total = start ? differenceInCalendarDays(parseDateISO(init.targetDate), start) : null;
  const elapsed = start ? differenceInCalendarDays(today, start) : null;
  const expected = total && total > 0 && elapsed != null ? clamp01(elapsed / total) * 100 : null;

  let pace: Pace;
  if (expected != null) {
    const delta = progress - expected;
    if (delta >= 12) pace = "ahead";
    else if (delta <= -12 || daysLeft < 0) pace = "needs_pull";
    else pace = "on_track";
  } else {
    pace = daysLeft < 0 ? "needs_pull" : "on_track";
  }

  const out =
    daysLeft < 0
      ? `${-daysLeft}d past the mark`
      : daysLeft === 0
        ? "lands today"
        : `${daysLeft}d out`;
  const tone =
    pace === "ahead" ? "ahead of pace" : pace === "needs_pull" ? "ready for a pull" : "on pace";
  return { initiative: init, domain, progress, daysLeft, pace, line: `${out} · ${tone}` };
}

// ── When you're ready — neglect reframed as an open invitation ───────────────

export interface Invitation {
  investedMost: { domain: Domain; hours: number } | null;
  readyForYou: Domain | null; // the quietest domain, framed as available — not failed
}

function readInvitation(domains: Domain[]): Invitation {
  const invested = domains.filter((d) => d.investedThisWeek > 0).sort((a, b) => b.investedThisWeek - a.investedThisWeek);
  const investedMost = invested[0] ? { domain: invested[0], hours: invested[0].investedThisWeek } : null;
  const quiet = [...domains].sort((a, b) => b.lastTouchedDays - a.lastTouchedDays)[0];
  const readyForYou = quiet && quiet.lastTouchedDays >= 5 ? quiet : null;
  return { investedMost, readyForYou };
}

// ── The whole read ───────────────────────────────────────────────────────────

export interface StandbackRead {
  greeting: string; // a gain-framed headline — what you've built this week
  hoursThisWeek: number;
  betsMoved: number;
  wins: Win[]; // the Gain — most meaningful first
  compass: Forward[]; // active bets as direction, nearest finish line first
  invitation: Invitation;
}

export function readStandback(d: VerticalData, now: Date = new Date()): StandbackRead {
  const weekStart = startOfWeek(parseDateISO(todayISO(now)), { weekStartsOn: 1 });

  const wins = [...initiativeWins(d, weekStart), ...unblockWins(d, weekStart), ...faithWins(d.domains)]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const hoursThisWeek = d.domains.reduce((s, dom) => s + dom.investedThisWeek, 0);
  // bets moved = initiatives whose progress actually advanced since last week
  const betsMoved = d.initiatives.filter(
    (i) => initiativeProgress(d, i) > initiativeProgressAt(d, i, weekStart),
  ).length;

  const compass = d.initiatives
    .filter((i) => isProjectInFlight(i.status))
    .map((i) => readForward(d, i, now))
    .sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));

  return {
    greeting: composeGain(hoursThisWeek, betsMoved, wins),
    hoursThisWeek,
    betsMoved,
    wins,
    compass,
    invitation: readInvitation(d.domains),
  };
}

function composeGain(hours: number, betsMoved: number, wins: Win[]): string {
  if (hours <= 0 && wins.length === 0) {
    return "A quiet week on the board so far — nothing logged yet. The slate's open, and rest counts too.";
  }
  const parts: string[] = [];
  const lead =
    betsMoved > 0
      ? `This week you've put in ${fmtH(hours)} and moved ${betsMoved} bet${betsMoved === 1 ? "" : "s"} forward.`
      : `This week you've put in ${fmtH(hours)} of real work.`;
  parts.push(lead);

  // Let the single biggest gain speak its meaning, so the headline lands.
  const standout = wins.find((w) => w.kind === "shipped" || w.kind === "milestone" || w.kind === "unblocked");
  if (standout) parts.push(`${standout.headline}.`);
  return parts.join(" ");
}
