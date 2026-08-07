// The intelligent Now. Given the vertical + the current moment, rank the ready
// tasks and explain *why* each rose — the daily dividend of the whole vertical.
// Heuristic for now; easy to swap weights or move to the agent later.

import {
  domainById,
  faithfulness,
  initiativeById,
  QUIET_SPEAKS_DAYS,
  type Domain,
  type Initiative,
  type VerticalData,
  type VTask,
} from "./vertical";
import { quietFor } from "./domainRead";
import { endOf } from "./dates";
import { isEventHidden } from "./eventActuals";
import type { ExternalEvent, Task } from "./types";

export interface Reason {
  glyph: string;
  text: string;
}

export interface Suggestion {
  task: VTask;
  domain: Domain | null;
  initiative: Initiative | null;
  score: number;
  reasons: Reason[];
}

export interface NowContext {
  /** Minutes until the next calendar commitment (the open gap). */
  gapMins: number;
  /** Is this a natural deep-focus window (mid-morning / mid-afternoon)? */
  deepWindow: boolean;
  clockLabel: string; // e.g. "3:12 PM"
  gapLabel: string; // e.g. "33m till your next meeting"
  /** The user told us they're low/spent — favor low-friction, defer deep work. */
  tired?: boolean;
}

/**
 * Build the moment. `nextCommitment` is the start of the next busy thing on
 * the live calendar (external event or scheduled block); null = open horizon.
 */
export function nowContext(at: Date, nextCommitment?: Date | null): NowContext {
  const h = at.getHours();
  const deepWindow = (h >= 9 && h < 12) || (h >= 14 && h < 16);
  const clockLabel = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (nextCommitment) {
    const gapMins = Math.max(5, Math.round((nextCommitment.getTime() - at.getTime()) / 60_000));
    const next = nextCommitment.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return { gapMins, deepWindow, clockLabel, gapLabel: `${gapMins}m till ${next}` };
  }
  // nothing on the calendar ahead — a long open block
  const gapMins = h >= 18 || h < 8 ? 90 : 120;
  const gapLabel = h >= 18 || h < 8 ? "open evening — nothing scheduled" : "open horizon — nothing scheduled";
  return { gapMins, deepWindow, clockLabel, gapLabel };
}

// ── Reading the shape of the day ─────────────────────────────────────────
// The Now view needs more than "the next gap" — a four-domain operator needs
// the whole arc: what you're in, what's next, where the open blocks are, and
// how much real focus time is left. readDay() turns the live calendar into
// that picture so a recommendation can land in an actual block, not in the
// abstract.

export interface BusyBlock {
  title: string;
  start: Date;
  end: Date;
  kind: "event" | "block"; // external commitment vs. your own scheduled task
  done?: boolean;
  location?: string | null;
  taskId?: string; // only for kind === "block" — the originating task row
}

export interface Gap {
  start: Date;
  end: Date;
  mins: number;
}

export interface DayRead {
  current: BusyBlock | null; // the thing you're inside right now (earliest-started, if stacked)
  overlapping: BusyBlock[]; // other commitments also covering now — the conflict stack
  next: BusyBlock | null; // the next commitment after now
  upcoming: BusyBlock[]; // the runway — the next few commitments, in order
  gaps: Gap[]; // forward open spans inside the work window
  openMins: number; // total open focus minutes still ahead
  remaining: number; // commitments still ahead today
  deepWindow: boolean;
  deepEndsLabel: string | null; // when the deep-focus window closes, if in one
}

const MIN_GAP = 10; // spans shorter than this aren't worth offering as focus time

/** Now stays out of your way until you have a genuinely big open block. Below
 *  this, it doesn't push unplanned work — it just reflects the day. Tunable. */
export const OPEN_OFFER_MINS = 90;

export function readDay(now: Date, busy: BusyBlock[], windowStart: Date, windowEnd: Date): DayRead {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const onNow = sorted.filter((b) => b.start <= now && now < b.end);
  const current = onNow[0] ?? null; // earliest-started of the stack reads as "the" meeting
  const overlapping = onNow.slice(1);
  const ahead = sorted.filter((b) => b.start > now);

  // Walk the work window from the present forward, collecting the open spans
  // between commitments. If you're mid-meeting, the first open block starts
  // when it ends — you can't focus during it.
  let cursor = new Date(Math.max(now.getTime(), windowStart.getTime()));
  if (current) cursor = new Date(Math.max(cursor.getTime(), current.end.getTime()));
  const gaps: Gap[] = [];
  const push = (start: Date, end: Date) => {
    const mins = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (mins >= MIN_GAP) gaps.push({ start, end, mins });
  };
  for (const b of sorted) {
    if (b.end <= cursor || b.start >= windowEnd) continue;
    if (b.start > cursor) push(cursor, b.start);
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < windowEnd) push(cursor, windowEnd);

  const openMins = gaps.reduce((s, g) => s + g.mins, 0);
  const h = now.getHours();
  const deepWindow = (h >= 9 && h < 12) || (h >= 14 && h < 16);
  let deepEndsLabel: string | null = null;
  if (deepWindow) {
    const ends = new Date(now);
    ends.setHours(h < 12 ? 12 : 16, 0, 0, 0);
    deepEndsLabel = ends.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  return {
    current,
    overlapping,
    next: ahead[0] ?? null,
    upcoming: ahead.slice(0, 4),
    gaps,
    openMins,
    remaining: ahead.length,
    deepWindow,
    deepEndsLabel,
  };
}

// ── Hiding individual events ─────────────────────────────────────────────
// A Fantastical-style "hide" keeps the event on the server but drops it from the
// board AND the busy math (so its time is free for blocking again). We key on the
// STABLE event key — account_id:provider_event_id — never external_events.id,
// which is reassigned on a calendar re-import. A whole series shares one key:
// account_id:series:recurring_event_id, so hiding the series hides every instance.

// The keys + the hidden test live in `eventActuals` (zero-dep) so the actuals
// ledger can apply the same rule without importing this module. Re-exported
// here because "what's hidden" and "what's busy" are read together.
export { eventInstanceKey, eventSeriesKey } from "./eventActuals";
export { isEventHidden };

/** Fold the live calendar — external events + your own scheduled task blocks —
 *  into the BusyBlock list readDay() consumes. Skips all-day events, anything
 *  marked free, any calendar the user has hidden in settings, and any individually
 *  hidden event. Shared by the Now view and the mobile Calendar so the "what counts
 *  as busy" rule lives once. */
export function toBusyBlocks(
  events: ExternalEvent[],
  blocks: Task[],
  hiddenCalendarIds: Iterable<string> = [],
  hiddenEventKeys: Iterable<string> = [],
): BusyBlock[] {
  const hidden = new Set(hiddenCalendarIds);
  const hiddenKeys = new Set(hiddenEventKeys);
  return [
    ...events
      .filter((e) => e.busy && !e.all_day && !hidden.has(e.calendar_id) && !isEventHidden(e, hiddenKeys))
      .map((e): BusyBlock => ({
        title: e.title,
        start: new Date(e.start_at),
        end: new Date(e.end_at),
        kind: "event",
        location: e.location,
      })),
    ...blocks
      .filter((t) => t.start_time)
      .map((t): BusyBlock => ({
        title: t.title,
        start: new Date(t.start_time!),
        end: endOf({ start_time: t.start_time!, duration_minutes: t.duration_minutes }),
        kind: "block",
        done: t.status === "done",
        taskId: t.id,
      })),
  ];
}

/** "1h 42m" · "45m" · "0m" — compact human duration for stat chips. */
export function fmtMins(mins: number): string {
  if (mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const ENERGY_GLYPH: Record<string, string> = { deep: "◆", decide: "▲", delegate: "⇢", quick: "•" };

export function rankNow(data: VerticalData, ctx: NowContext): Suggestion[] {
  // Now recommends from work you've actually considered — filed backlog,
  // committed, or parented — not the raw inbox capture pile (that's the Sweep's
  // job, a different altitude). Fall back to everything ready only if filtering
  // would leave you with nothing to do.
  const ready = data.tasks.filter((t) => t.status === "ready");
  const considered = ready.filter((t) => !t.inbox);
  const candidates = considered.length ? considered : ready;

  const scored = candidates.map((task): Suggestion => {
    const domain = domainById(data, task.domainId);
    const initiative = initiativeById(data, task.initiativeId);
    const reasons: Reason[] = [];
    let score = 0;

    // Faithfulness — the strongest pull. A starving domain wants you back.
    if (domain) {
      const f = faithfulness(domain);
      if (!f.lit) {
        const since = domain.lastTouchedDays ?? QUIET_SPEAKS_DAYS;
        const w = since >= QUIET_SPEAKS_DAYS ? 4 : 3;
        score += w;
        reasons.push({
          glyph: "⚖",
          text: domain.lastTouchedDays == null
            ? `nothing has landed in ${domain.name} yet`
            : `${domain.name} has been quiet ${quietFor(domain.lastTouchedDays)}`,
        });
      }
    }

    // Deadline pressure.
    if (task.deadlineDaysAway != null) {
      if (task.deadlineDaysAway <= 1) { score += 3; reasons.push({ glyph: "⚑", text: "due tomorrow" }); }
      else if (task.deadlineDaysAway <= 2) { score += 2; reasons.push({ glyph: "⚑", text: `due in ${task.deadlineDaysAway} days` }); }
      else if (task.deadlineDaysAway <= 5) { score += 1; reasons.push({ glyph: "⚑", text: `due in ${task.deadlineDaysAway} days` }); }
    }

    // Does it fit the open gap?
    if (task.durationMins <= ctx.gapMins) {
      score += 1;
      reasons.push({ glyph: "⏱", text: `fits your ${fmtMins(ctx.gapMins)} gap` });
    } else {
      score -= 2;
      reasons.push({ glyph: "⏱", text: `needs ${fmtMins(task.durationMins)} — bigger than this gap, block it` });
    }

    // Energy match to the window — and to how you're actually running today.
    if (task.energy) {
      const g = ENERGY_GLYPH[task.energy];
      const lowFriction = task.energy === "quick" || task.energy === "delegate";
      if (ctx.tired && task.energy === "deep") { score -= 2; reasons.push({ glyph: g, text: "deep work — save it for when you're fresh" }); }
      else if (ctx.tired && lowFriction) { score += 2; reasons.push({ glyph: g, text: "low-friction — kind to a tired you" }); }
      else if (ctx.deepWindow && task.energy === "deep") { score += 2; reasons.push({ glyph: g, text: "your deep-focus window" }); }
      else if (!ctx.deepWindow && lowFriction) { score += 1; reasons.push({ glyph: g, text: "low-friction, right for now" }); }
    }

    // The week pool first: you committed to this on Sunday.
    if (task.sprint) {
      score += 2;
      reasons.push({ glyph: "★", text: "committed this week" });
    }

    // The assistant already did the prep — lowest possible friction.
    if (task.preworkReady) {
      score += 2;
      reasons.push({ glyph: "✦", text: "prework is ready — just start" });
    }

    // Initiative momentum — keep the moving things moving.
    if (initiative && initiative.momentum === "up") {
      score += 1;
      reasons.push({ glyph: "↑", text: `moves ${initiative.name} ${initiative.progress}%→` });
    }

    return { task, domain, initiative, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score || a.task.durationMins - b.task.durationMins);
}
