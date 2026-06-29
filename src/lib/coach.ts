// The execution coach. Given the live shape of the day, read it back as a
// *recommendation* — the Call (the posture for the whole day), the one move
// that matters, the surprises worth fixing, and what slipped — so you walk in
// prepared, not caught out.
//
// The governing rule: a metric never shows naked here. "8 context switches" is
// a dashboard; "trim the softest of your three back-to-back calls" is coaching.
// So readVitals() computes the numbers, and everything the user sees turns a
// number into a sentence with a verb. All of this is deterministic from the
// live calendar — an AI can re-voice the Call later, but the structure stands
// on its own.

import { endOf } from "./dates";
import { fmtMins, type BusyBlock, type DayRead, type Gap } from "./now";
import type { Task } from "./types";

const BACK_TO_BACK_GAP = 10; // mins — below this, two commitments are "stacked"
const PROTECT_MIN = 60; // mins — the smallest open run worth protecting as focus
const LUNCH_START = 11 * 60 + 30; // a real midday break must fall in this window
const LUNCH_END = 14 * 60;
const LUNCH_MIN = 30;

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ── Vitals — the numbers behind the read (never shown raw) ─────────────────
export interface Vitals {
  meetings: number;
  meetingMins: number;
  committedMins: number;
  windowMins: number;
  loadPct: number; // 0..1 of the work window that's booked
  span: { start: Date; end: Date; mins: number } | null;
  longestRunAhead: Gap | null; // biggest open block still ahead of now
  switches: number; // transitions between commitments across the day
  backToBack: number; // adjacent pairs with no real gap
  wall: { start: Date; end: Date; count: number } | null; // longest stacked run
  longestBreakMins: number;
  noLunch: boolean;
  verdict: "light" | "moderate" | "heavy" | "wall";
}

function overlapMins(b: BusyBlock, ws: Date, we: Date): number {
  const s = Math.max(b.start.getTime(), ws.getTime());
  const e = Math.min(b.end.getTime(), we.getTime());
  return Math.max(0, (e - s) / 60_000);
}

/** Collapse overlapping commitments into a clean non-overlapping timeline. */
function mergeBlocks(sorted: BusyBlock[]): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start.getTime() <= last.end.getTime()) {
      if (b.end.getTime() > last.end.getTime()) last.end = b.end;
    } else out.push({ start: b.start, end: b.end });
  }
  return out;
}

/** The open intervals across the work window, given the merged commitments. */
function freeIntervals(merged: { start: Date; end: Date }[], ws: Date, we: Date): [number, number][] {
  const out: [number, number][] = [];
  let cursor = ws.getTime();
  for (const m of merged) {
    if (m.start.getTime() > cursor) out.push([cursor, m.start.getTime()]);
    cursor = Math.max(cursor, m.end.getTime());
  }
  if (cursor < we.getTime()) out.push([cursor, we.getTime()]);
  return out;
}

function hasLunch(free: [number, number][], ws: Date): boolean {
  const lunchStart = new Date(ws); lunchStart.setHours(0, LUNCH_START, 0, 0);
  const lunchEnd = new Date(ws); lunchEnd.setHours(0, LUNCH_END, 0, 0);
  return free.some(([s, e]) => {
    const os = Math.max(s, lunchStart.getTime());
    const oe = Math.min(e, lunchEnd.getTime());
    return (oe - os) / 60_000 >= LUNCH_MIN;
  });
}

function classify(loadPct: number, meetings: number, wall: Vitals["wall"]): Vitals["verdict"] {
  if (wall && wall.count >= 3) return "wall";
  if (loadPct >= 0.6 || meetings >= 5) return "heavy";
  if (loadPct >= 0.3 || meetings >= 2) return "moderate";
  return "light";
}

export function readVitals(
  _now: Date,
  busy: BusyBlock[],
  dayRead: DayRead,
  windowStart: Date,
  windowEnd: Date,
): Vitals {
  const win = busy
    .filter((b) => b.end > windowStart && b.start < windowEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const meetingsArr = win.filter((b) => b.kind === "event");
  const meetings = meetingsArr.length;
  const meetingMins = Math.round(meetingsArr.reduce((s, b) => s + overlapMins(b, windowStart, windowEnd), 0));

  const merged = mergeBlocks(win);
  const committedMins = Math.round(merged.reduce((s, m) => s + Math.max(0, (Math.min(m.end.getTime(), windowEnd.getTime()) - Math.max(m.start.getTime(), windowStart.getTime())) / 60_000), 0));
  const windowMins = Math.max(60, (windowEnd.getTime() - windowStart.getTime()) / 60_000);
  const loadPct = Math.min(1, committedMins / windowMins);

  const span = win.length
    ? { start: win[0].start, end: win[win.length - 1].end, mins: Math.round((win[win.length - 1].end.getTime() - win[0].start.getTime()) / 60_000) }
    : null;

  const longestRunAhead = dayRead.gaps.reduce<Gap | null>((best, g) => (!best || g.mins > best.mins ? g : best), null);

  let switches = 0;
  let backToBack = 0;
  let longestBreakMins = 0;
  let runStart: Date | null = null;
  let runCount = 0;
  let wall: Vitals["wall"] = null;
  for (let i = 1; i < merged.length; i++) {
    switches++;
    const gapMins = (merged[i].start.getTime() - merged[i - 1].end.getTime()) / 60_000;
    longestBreakMins = Math.max(longestBreakMins, gapMins);
    if (gapMins < BACK_TO_BACK_GAP) {
      backToBack++;
      if (runStart == null) { runStart = merged[i - 1].start; runCount = 2; } else runCount++;
      if (!wall || runCount > wall.count) wall = { start: runStart, end: merged[i].end, count: runCount };
    } else {
      runStart = null;
      runCount = 0;
    }
  }

  const noLunch = !hasLunch(freeIntervals(merged, windowStart, windowEnd), windowStart);
  const verdict = classify(loadPct, meetings, wall);

  return { meetings, meetingMins, committedMins, windowMins, loadPct, span, longestRunAhead, switches, backToBack, wall, longestBreakMins: Math.round(longestBreakMins), noLunch, verdict };
}

// ── The Call — the one line that frames the day, plus the live "right now" ──
export interface DayCall {
  chip: string;
  tone: "good" | "amber" | "bad" | "neutral";
  headline: string;
  rightNow: string;
}

function readRightNow(now: Date, dayRead: DayRead): string {
  if (dayRead.current) {
    const left = Math.max(1, Math.round((dayRead.current.end.getTime() - now.getTime()) / 60_000));
    return `In “${dayRead.current.title}” — ${fmtMins(left)} left.`;
  }
  const g0 = dayRead.gaps[0];
  const openNow = g0 && g0.start.getTime() <= now.getTime() + 60_000;
  if (dayRead.next) {
    const to = Math.max(1, Math.round((dayRead.next.start.getTime() - now.getTime()) / 60_000));
    if (to <= 15) return `${fmtMins(to)} to ${dayRead.next.title} — too tight to start anything. Breathe, line it up.`;
    if (openNow && g0 && g0.mins >= PROTECT_MIN) return `You're in your best window — ${fmtMins(g0.mins)} clear before ${dayRead.next.title}. Use it.`;
    return `${fmtMins(to)} until ${dayRead.next.title}.`;
  }
  if (openNow && g0 && g0.mins >= PROTECT_MIN) return `Clear from here on — ${fmtMins(dayRead.openMins)} open. This is the time to go deep.`;
  return `Nothing left on the calendar. Call it, or pick one thing up.`;
}

function verdictChip(v: Vitals["verdict"]): string {
  return v === "light" ? "OPEN RUNWAY" : v === "moderate" ? "STEADY" : v === "heavy" ? "HEAVY DAY" : "HEAVY · WALL";
}

export function composeCall(now: Date, vitals: Vitals, dayRead: DayRead, restDay: boolean, offPlan: boolean): DayCall {
  const rightNow = readRightNow(now, dayRead);
  const run = vitals.longestRunAhead;
  const hasRun = !!run && run.mins >= PROTECT_MIN;

  if (restDay) {
    return { chip: "DAY OFF", tone: "neutral", headline: "It's a day off. Nothing's owed — pick something up only if you want to.", rightNow };
  }

  if (offPlan) {
    return {
      chip: `${verdictChip(vitals.verdict).split(" ")[0]} · OFF PLAN`,
      tone: "amber",
      headline: hasRun
        ? `The plan slipped — but the day isn't lost. You've still got ${fmtMins(run!.mins)} free at ${clock(run!.start)}; put the one thing that matters there.`
        : "The plan slipped, and there's not much room left. Pick the one thing that has to happen and send the rest to tomorrow.",
      rightNow,
    };
  }

  switch (vitals.verdict) {
    case "wall":
      return {
        chip: "HEAVY · WALL", tone: "bad",
        headline: `You won't build today — you'll respond. The wall is ${clock(vitals.wall!.start)}–${clock(vitals.wall!.end)}; ${hasRun ? `your one shot at real work is ${clock(run!.start)}.` : "guard your edges and ride it."}`,
        rightNow,
      };
    case "heavy":
      return {
        chip: "HEAVY DAY", tone: "bad",
        headline: hasRun
          ? `A full day — ${vitals.meetings} meetings. You get one real block at ${clock(run!.start)}; spend it on what matters and ride the rest.`
          : `A full day — ${vitals.meetings} meetings and almost no whitespace. Stay reactive, protect your edges, don't try to think between calls.`,
        rightNow,
      };
    case "moderate":
      return {
        chip: "STEADY", tone: "good",
        headline: hasRun
          ? `A workable day with room to think. Your best stretch is ${clock(run!.start)} — put your hardest thing there.`
          : `A workable day — a few commitments, the rest is yours. Pick one thing that matters and start it.`,
        rightNow,
      };
    default:
      return {
        chip: "OPEN RUNWAY", tone: "good",
        headline: `Today's wide open — this is a build day. Pick one hard thing, protect it, and don't let small stuff fill the space.`,
        rightNow,
      };
  }
}

// ── Moves — the recommendation, as actions ─────────────────────────────────
export type MoveKind = "protect" | "recover" | "runway" | "no-lunch" | "stacked" | "no-buffer";

export interface CoachMove {
  kind: MoveKind;
  title: string;
  reason: string;
  gap?: Gap; // protect / recover target window — also the lunch/prep slot for fixes
  taskId?: string; // recover: the missed block to re-home
  meetingTitle?: string; // no-buffer: the meeting to prep for
  seed?: string; // a fix the app can't do alone (e.g. trim a read-only meeting) routes to Nuvo
}

export interface SlippedItem {
  task: Task;
  reason: string;
}

export interface MoveSet {
  primary: CoachMove | null;
  fixes: CoachMove[];
  slipped: SlippedItem[];
}

function noBufferBefore(now: Date, dayRead: DayRead): BusyBlock | null {
  const seq = [dayRead.current, ...dayRead.upcoming].filter((b): b is BusyBlock => !!b);
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1];
    const b = seq[i];
    if (b.start.getTime() <= now.getTime()) continue;
    if (b.kind === "event" && (b.start.getTime() - prev.end.getTime()) / 60_000 < BACK_TO_BACK_GAP) return b;
  }
  return null;
}

export function detectMoves(
  now: Date,
  _busy: BusyBlock[],
  dayRead: DayRead,
  vitals: Vitals,
  blocks: Task[],
  restDay: boolean,
): MoveSet {
  // What slipped: your own time-blocks that ended before now and aren't done.
  const slipped: SlippedItem[] = blocks
    .filter((t) => t.start_time && t.status !== "done" && endOf({ start_time: t.start_time, duration_minutes: t.duration_minutes }) <= now)
    .sort((a, b) => (b.duration_minutes ?? 0) - (a.duration_minutes ?? 0))
    .map((t) => ({ task: t, reason: `blocked ${clock(new Date(t.start_time!))} — didn't happen` }));

  const offPlan = slipped.length > 0;
  const run = vitals.longestRunAhead;
  const hasRun = !!run && run.mins >= 45;

  let primary: CoachMove | null = null;
  if (restDay) {
    primary = null;
  } else if (offPlan) {
    const top = slipped[0].task;
    primary = hasRun
      ? {
          kind: "recover", taskId: top.id, gap: run!,
          title: `“${top.title}” didn't happen — re-home it.`,
          reason: `You've still got ${fmtMins(run!.mins)} free at ${clock(run!.start)}. Drop it there, or roll it to tomorrow.`,
        }
      : {
          kind: "recover", taskId: top.id,
          title: `“${top.title}” slipped, and there's no real block left today.`,
          reason: `Roll it to tomorrow rather than cram it into the cracks.`,
        };
  } else if (run && run.mins >= PROTECT_MIN) {
    primary = {
      kind: "protect", gap: run,
      title: `Protect ${clock(run.start)}–${clock(run.end)} for focus.`,
      reason: `Your longest clear run today — ${fmtMins(run.mins)}. Hold it before it fills.`,
    };
  } else if (vitals.verdict === "light") {
    primary = {
      kind: "runway",
      title: `Open runway — block your one big thing now.`,
      reason: `Nothing's forcing your hand. Put the hardest thing on the calendar before the day leaks away.`,
    };
  }

  const fixes: CoachMove[] = [];
  if (!restDay) {
    if (vitals.noLunch && vitals.meetings >= 2) {
      // somewhere to put it: the biggest open run ahead worth eating in
      const lunchGap = dayRead.gaps.filter((g) => g.mins >= 25).sort((a, b) => b.mins - a.mins)[0] ?? null;
      fixes.push({
        kind: "no-lunch", title: "No real break midday.",
        reason: lunchGap ? `Nothing over 30 minutes near lunch. Hold a bite in your ${fmtMins(lunchGap.mins)} at ${clock(lunchGap.start)}.` : "Nothing over 30 minutes from late morning to 2. You'll fade by the afternoon.",
        gap: lunchGap ?? undefined,
        seed: "I've got no real break midday — find me thirty minutes to eat.",
      });
    }
    if (vitals.wall && vitals.wall.count >= 2) {
      fixes.push({
        kind: "stacked", title: `${vitals.wall.count} back-to-back, ${clock(vitals.wall.start)}–${clock(vitals.wall.end)}.`,
        reason: "No transitions in there — you'll walk into one cold. Want me to shield a moment around it?",
        seed: `I have ${vitals.wall.count} back-to-back meetings ${clock(vitals.wall.start)}–${clock(vitals.wall.end)} with no gaps — help me protect a breather or move my own blocks out of the way.`,
      });
    }
    const nb = noBufferBefore(now, dayRead);
    if (nb) {
      // a place to prep earlier: the latest open run that ends before the meeting
      const prepGap = dayRead.gaps.filter((g) => g.mins >= 10 && g.end.getTime() <= nb.start.getTime()).sort((a, b) => b.start.getTime() - a.start.getTime())[0] ?? null;
      fixes.push({
        kind: "no-buffer", title: `No prep time before ${nb.title}.`,
        reason: prepGap ? `It starts the second the thing before it ends. Block ten minutes at ${clock(prepGap.start)} to get ready.` : "It starts the second the thing before it ends. Steal ten minutes earlier, or you're winging it.",
        gap: prepGap ?? undefined,
        meetingTitle: nb.title,
        seed: `I have no prep time before ${nb.title} — help me carve out ten minutes to get ready.`,
      });
    }
  }

  return { primary, fixes: fixes.slice(0, 3), slipped };
}
