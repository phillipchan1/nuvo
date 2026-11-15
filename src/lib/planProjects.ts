/**
 * Plan projects / Plan initiatives — the pure half (D-216, docs/offer-rules.md §4).
 *
 * The rail's Plan mode on the decks: the same walk as Plan the week, a slower
 * clock. It walks the deck's not-Ready items, rawest first, one at a time, in
 * two phases — the work (tasks, or a bet's outcome and number), then the time
 * (a span of weeks, or a quarter) — and writes nothing until you press.
 *
 * What lives here is everything the walk DECIDES, so both shells and the tests
 * read one answer: the walk's order, the draft's lines and R12's pinning (a
 * steer never rewrites a line you touched), the weekly pace a span is sized
 * at, the spans offered and what each one costs, and the labels.
 *
 * Pure: no React, no network, no clock of its own.
 */

import { addDays, differenceInCalendarDays, format } from "date-fns";

// ── the walk ─────────────────────────────────────────────────────────────────

export interface WalkCandidate {
  id: string;
  name: string;
  /** readiness axes met, 0–3 (a project) or 0–2 (a bet) — rawest first */
  met: number;
  /** where it sits on the deck (0 = this week / quarter) — nearer first */
  at: number;
}

/** The walk's order: rawest first, then the nearest, then by name — fixed when
 *  the walk opens, so the deck changing under your hand never reshuffles it. */
export function walkOrder(items: readonly WalkCandidate[]): string[] {
  return [...items].sort((a, b) => a.met - b.met || a.at - b.at || a.name.localeCompare(b.name)).map((x) => x.id);
}

/** "Ready 3 of 5" — a state of the deck (D-201), never a tally of acts (N-04). */
export const readyCounter = (ready: number, total: number) => `Ready ${ready} of ${total}`;

/** Look at it last: the walked item moves to the end of the line. */
export function lookLast(order: readonly string[], id: string): string[] {
  const rest = order.filter((x) => x !== id);
  return rest.length === order.length ? [...order] : [...rest, id];
}

// ── the draft's lines ───────────────────────────────────────────────────────

/** One line of the drafted work, not yet a task. */
export interface PlanLine {
  key: string;
  title: string;
  mins: number;
  /** Nuvo drafted it, or you typed it */
  from: "nuvo" | "you";
  /** you renamed or resized it — a steer leaves it alone (R12) */
  touched: boolean;
  /** where the size came from, for a Nuvo line (R4) */
  measured?: boolean;
}

/** A line a steer may redraft: Nuvo's, and untouched. Everything else is yours. */
export const pinned = (l: PlanLine) => l.from === "you" || l.touched;

/**
 * R12 — a steer redrafts only Nuvo's untouched lines. Every pinned line keeps
 * its place; the redrafted lines go where the first unpinned line stood (or
 * at the end, when every line is pinned).
 */
export function mergeSteer(lines: readonly PlanLine[], redraftedIn: readonly PlanLine[]): PlanLine[] {
  const firstFree = lines.findIndex((l) => !pinned(l));
  const kept = lines.filter(pinned);
  // a redraft never hands you back a line you already have
  const mine = new Set(kept.map((l) => l.title.trim().toLowerCase()));
  const redrafted = redraftedIn.filter((l) => !mine.has(l.title.trim().toLowerCase()));
  if (firstFree < 0) return [...kept, ...redrafted];
  const before = lines.slice(0, firstFree).filter(pinned).length;
  return [...kept.slice(0, before), ...redrafted, ...kept.slice(before)];
}

/** The titles a steer hands back to the drafter to redraft. */
export const redraftTitles = (lines: readonly PlanLine[]) => lines.filter((l) => !pinned(l)).map((l) => l.title);

/** The sizes a press on a line's length cycles through. */
export const SIZES = [15, 30, 45, 60, 90, 120, 180] as const;

/** The next size up, wrapping back to the smallest. */
export function nextSize(mins: number): number {
  return SIZES.find((s) => s > mins) ?? SIZES[0];
}

/** The size every line takes when there's no finished work to size from (§4). */
export const DEFAULT_LINE_MINS = 30;

export const lineMins = (lines: readonly PlanLine[]) => lines.reduce((s, l) => s + l.mins, 0);

/** "Add 4 tasks to Rebuild the newsletter" — tasks, never steps (D-103, P11). */
export function commitLabel(n: number, projectName: string): { verb: string; name: string } {
  return { verb: `Add ${n} task${n === 1 ? "" : "s"} to`, name: projectName };
}

/** What the drafted sizes are built from, in one muted line (R4). */
export function sizesSaid(lines: readonly PlanLine[], domainName: string, noHistory: boolean): string | null {
  const nuvo = lines.filter((l) => l.from === "nuvo" && !l.touched);
  if (!nuvo.length) return null;
  if (noHistory) return `Every size is a ${DEFAULT_LINE_MINS}m guess — nothing finished in ${domainName} to size from yet`;
  const measured = nuvo.filter((l) => l.measured).length;
  if (measured === 0) return "Sizes are estimates — nothing you've finished looks like these";
  if (measured === nuvo.length) return `Sized from your finished work in ${domainName}`;
  return `${measured} sized from your finished work in ${domainName}, ${nuvo.length - measured} estimated`;
}

// ── the pace a span is sized at ─────────────────────────────────────────────

/** The pace a project is sized at when a domain has no history (§4: a named default). */
export const DEFAULT_PACE_MINS = 90;

export interface Pace {
  minsPerWeek: number;
  source: "usual" | "target" | "default";
  /** said on screen: where the pace came from */
  said: string;
}

const hrs = (mins: number) => {
  const h = Math.round((mins / 60) * 2) / 2;
  return `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)}h`;
};

/**
 * Your usual weekly pace in a domain: the median of the finished weeks you
 * put in (the last element of `weeks` is this week, still running, so it
 * doesn't count). Three or more worked weeks make a usual; fewer fall back to
 * the domain's own weekly target; none of either is a default, and says so (P6).
 */
export function domainPace(domain: { name: string; weeks?: readonly number[] | null; weeklyTargetHours?: number | null }): Pace {
  const past = (domain.weeks ?? []).slice(0, -1).filter((h) => h > 0);
  if (past.length >= 3) {
    const s = [...past].sort((a, b) => a - b);
    const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    const mins = Math.max(30, Math.round((m * 60) / 15) * 15);
    return { minsPerWeek: mins, source: "usual", said: `at your usual ${hrs(mins)} a week in ${domain.name}` };
  }
  const target = domain.weeklyTargetHours ?? 0;
  if (target > 0) {
    const mins = Math.round(target * 60);
    return { minsPerWeek: mins, source: "target", said: `at your ${hrs(mins)}-a-week target for ${domain.name}` };
  }
  return {
    minsPerWeek: DEFAULT_PACE_MINS,
    source: "default",
    said: `at ${hrs(DEFAULT_PACE_MINS)} a week — a default, no weeks logged in ${domain.name} yet`,
  };
}

/** How many whole weeks the work takes at that pace: at least one, at most a quarter. */
export function spanWeeks(totalMins: number, minsPerWeek: number): number {
  if (!(totalMins > 0) || !(minsPerWeek > 0)) return 1;
  return Math.max(1, Math.min(13, Math.ceil(totalMins / minsPerWeek)));
}

// ── the spans offered, and what each costs ──────────────────────────────────

/** Another project's time on the deck, in week indexes from the deck's first week. */
export interface Occupant {
  id: string;
  name: string;
  domainId: string | null;
  start: number;
  end: number;
}

export interface SpanOffer {
  /** first week index (0 = the deck's first week) */
  start: number;
  weeks: number;
  /** "Nov 16 – Dec 4" — the destination, by the deck's own column names */
  label: string;
  /** R5 — what it collides with, in words, or null when the weeks are clear */
  cost: string | null;
  /** why this one, when it's the second answer (R13) */
  reason: string | null;
}

export interface SpanInput {
  /** the deck's first week (a week start) */
  base: Date;
  /** the walked project */
  id: string;
  domainId: string | null;
  weeks: number;
  /** the earliest week it may start (its current start, or this week) */
  earliest: number;
  others: readonly Occupant[];
  /** your per-week cap of open projects */
  cap: number;
  /** how far ahead to look for clear weeks */
  lookahead?: number;
}

const weekOf = (base: Date, i: number) => addDays(base, i * 7);

/** "Nov 16 – Dec 4": the first Monday to the last week's Friday. */
export function spanLabel(base: Date, start: number, weeks: number): string {
  const a = weekOf(base, start);
  const b = addDays(weekOf(base, start + weeks - 1), 4);
  return a.getMonth() === b.getMonth() ? `${format(a, "MMM d")}–${format(b, "d")}` : `${format(a, "MMM d")} – ${format(b, "MMM d")}`;
}

/** What placing [start, start+weeks) costs: the first same-domain overlap, else
 *  the first week over the cap. Null = clear. */
export function spanCost(input: SpanInput, start: number): string | null {
  const end = start + input.weeks - 1;
  const others = input.others.filter((o) => o.id !== input.id);
  const clash = others
    .filter((o) => o.domainId != null && o.domainId === input.domainId && o.start <= end && start <= o.end)
    .sort((a, b) => Math.max(a.start, start) - Math.max(b.start, start))[0];
  if (clash) return `Overlaps ${clash.name} the week of ${format(weekOf(input.base, Math.max(clash.start, start)), "MMM d")}`;
  for (let w = start; w <= end; w++) {
    const load = others.filter((o) => o.start <= w && w <= o.end).length + 1;
    if (load > input.cap) return `The week of ${format(weekOf(input.base, w), "MMM d")} would hold ${load} · room for ${input.cap}`;
  }
  return null;
}

/**
 * Up to two spans (R13): the soonest — from where the project already starts —
 * with its cost named; and, when that one costs something, the first span with
 * clear weeks, later. A clear soonest span is the only answer.
 */
export function spanOffers(input: SpanInput): SpanOffer[] {
  const first = Math.max(0, input.earliest);
  const soon: SpanOffer = { start: first, weeks: input.weeks, label: spanLabel(input.base, first, input.weeks), cost: spanCost(input, first), reason: null };
  if (!soon.cost) return [soon];
  const look = input.lookahead ?? 26;
  for (let s = first + 1; s <= first + look; s++) {
    if (!spanCost(input, s)) return [soon, { start: s, weeks: input.weeks, label: spanLabel(input.base, s, input.weeks), cost: null, reason: "Clear weeks · later" }];
  }
  return [soon];
}

/** A dated span → week indexes from the deck's first week (the deck's own geometry). */
export function occupantSpan(base: Date, startISO: string | null, targetISO: string | null): { start: number; end: number } | null {
  if (!targetISO) return null;
  const idx = (iso: string) => Math.floor(differenceInCalendarDays(new Date(iso + "T12:00:00"), base) / 7);
  const end = idx(targetISO);
  const start = startISO ? Math.min(idx(startISO), end) : end;
  return { start, end };
}

// ── quarters (Plan initiatives) ─────────────────────────────────────────────

export interface QuarterOccupant {
  id: string;
  name: string;
  domainId: string | null;
  quarter: number;
}

export interface QuarterOffer {
  quarter: number;
  cost: string | null;
  reason: string | null;
}

/** Up to two quarters: the soonest with its cost (a same-domain bet already
 *  finishing there, or the quarter over your cap), and the first clear one. */
export function quarterOffers(input: {
  id: string;
  domainId: string | null;
  earliest: number;
  quarters: number;
  labelOf: (q: number) => string;
  others: readonly QuarterOccupant[];
  cap: number;
}): QuarterOffer[] {
  const costOf = (q: number): string | null => {
    const here = input.others.filter((o) => o.id !== input.id && o.quarter === q);
    const clash = here.find((o) => o.domainId != null && o.domainId === input.domainId);
    if (clash) return `${clash.name} also finishes in ${input.labelOf(q)}`;
    if (here.length + 1 > input.cap) return `${input.labelOf(q)} would hold ${here.length + 1} · room for ${input.cap}`;
    return null;
  };
  const first = Math.max(0, Math.min(input.earliest, input.quarters - 1));
  const soon: QuarterOffer = { quarter: first, cost: costOf(first), reason: null };
  if (!soon.cost) return [soon];
  for (let q = first + 1; q < input.quarters; q++) if (!costOf(q)) return [soon, { quarter: q, cost: null, reason: "A clear quarter · later" }];
  return [soon];
}

/**
 * What a steer asks for that can be held to, not just hoped for (R12's
 * partner). The drafter is a small, fast model and does not reliably obey
 * "fewer" or "smaller", so the walk enforces the measurable part itself:
 *
 *   "fewer" / "less" / "trim" / "too many" → at most half as many of Nuvo's
 *                                           lines as it had (at least one)
 *   "smaller" / "shorter" / "split" / "bite" → every Nuvo line ≤ 45 minutes
 *
 * Anything else ("start with a call to Ana") is left to the model.
 */
export const SMALL_LINE_MINS = 45;
export function steerLimits(steer: string, previousNuvoLines: number): { maxCount: number | null; maxMins: number | null } {
  const s = steer.toLowerCase();
  const fewer = /\b(fewer|less|trim|too many|cut)\b/.test(s);
  const smaller = /\b(smaller|shorter|split|bite|bite-sized|quicker)\b/.test(s);
  return {
    maxCount: fewer ? Math.max(1, Math.floor(previousNuvoLines / 2)) : null,
    maxMins: smaller ? SMALL_LINE_MINS : null,
  };
}

/** A redraft held to its steer's limits. */
export function applySteerLimits(lines: PlanLine[], limits: { maxCount: number | null; maxMins: number | null }): PlanLine[] {
  const capped = limits.maxCount == null ? lines : lines.slice(0, limits.maxCount);
  return limits.maxMins == null ? capped : capped.map((l) => (l.mins > limits.maxMins! ? { ...l, mins: limits.maxMins! } : l));
}
