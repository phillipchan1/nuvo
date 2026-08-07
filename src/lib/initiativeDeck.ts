// Initiative On Deck — the initiative altitude's planning surface, the sibling of
// lib/onDeck.ts (projects). Where projects time-box onto WEEKS, bets time-box onto
// QUARTERS: an initiative is the multi-month arc, so its "when" is which quarter it
// lands in. Pure over a VerticalData snapshot — no new scoring, only an arrangement
// of what the OKR / tending / lens engines already return (initiativeAttainment,
// initiativeAtRisk, uncoveredKeyResults, lensGaps).

import {
  addQuarters,
  endOfQuarter,
  getQuarter,
  getYear,
  startOfQuarter,
} from "date-fns";
import {
  domainById,
  initiativeAttainment,
  initiativeAtRisk,
  isOpenStatus,
  isProjectComplete,
  uncoveredKeyResults,
  type Domain,
  type Initiative,
  type Project,
  type VerticalData,
} from "./vertical";
import { lensGaps, type LensGap } from "./lenses";
import { domainCorpus } from "../../supabase/functions/_shared/domainRouting.ts";

/** Concrete quarter columns shown on the deck (this + next 3). Initiatives targeted
 *  further out than this just clamp into the furthest column — the inbox already
 *  covers "not committed to a near quarter yet." */
export const HORIZON_QUARTERS = 4;

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The finish-line date for an initiative placed in a quarter — its last day. */
export const quarterEndISO = (start: Date) => toISO(endOfQuarter(start));

/** A quarter's short name, e.g. "Q3 2026". */
export const quarterName = (d: Date) => `Q${getQuarter(d)} ${getYear(d)}`;

/** A quarter's month span, e.g. "Jul – Sep 2026" — so a column reads its own
 *  start and end at a glance, not just a Q-number. */
export const quarterRangeLabel = (start: Date, end: Date) => {
  const m = (x: Date) => x.toLocaleDateString(undefined, { month: "short" });
  return `${m(start)} – ${m(end)} ${end.getFullYear()}`;
};

// ── lane state — OKR-first, mirroring onDeck's LaneState vocabulary ───────────
export type InitiativeLaneState =
  | "on_track"
  | "at_risk"
  | "needs_okrs"
  | "needs_shaping"
  | "idea"
  | "parked";

export interface InitiativeLane {
  initiative: Initiative;
  state: InitiativeLaneState;
  /** OKR attainment (mean KR gain), null when the bet carries no key results. */
  attainment: number | null;
  krCount: number;
  /** key results nothing is working toward — the alignment gap. */
  uncovered: number;
  atRisk: { atRisk: boolean; reasons: string[] };
  /** grooming gaps (Brief / Path) still open. */
  gaps: LensGap[];
  /** whether this bet still needs a domain (the "main" it belongs under). */
  needsDomain: boolean;
  /** which horizon quarter its finish line lands in (0 = this quarter). null =
   *  no finish line yet (it sits in the inbox). */
  quarterIdx: number | null;
  /** true when the target quarter is in the past — an overdue bet clamped to now. */
  overdue: boolean;
}

export interface QuarterColumn {
  idx: number;
  start: Date;
  end: Date;
  key: string; // "2026-Q3"
  label: string; // "This quarter" | "Next quarter" | "Q1 2027"
  shortLabel: string; // "Q3 2026"
}

export interface InitiativeDeckBoard {
  quarters: QuarterColumn[];
  /** placed bets (a finish line inside/around the horizon), keyed to a column. */
  lanes: InitiativeLane[];
  /** bets with no finish line yet — they need a quarter. */
  inbox: Initiative[];
  horizonQuarters: number;
}

/** Serial quarter number so differences are trivial: year*4 + (q-1). */
const quarterSerial = (d: Date) => getYear(d) * 4 + (getQuarter(d) - 1);

/** Which horizon column a finish line lands in. Past → 0 (clamped, overdue);
 *  ≥ HORIZON_QUARTERS out → clamped into the furthest column. */
export function targetQuarterIdx(targetISO: string, now: Date): number {
  const target = new Date(targetISO + "T12:00:00");
  const diff = quarterSerial(target) - quarterSerial(now);
  if (diff < 0) return 0;
  if (diff >= HORIZON_QUARTERS) return HORIZON_QUARTERS - 1;
  return diff;
}

function laneState(
  i: Initiative,
  gaps: LensGap[],
  atRisk: { atRisk: boolean; reasons: string[] },
): InitiativeLaneState {
  if (i.status === "waiting") return "parked";
  if (!i.targetDate) return "idea";
  if (i.keyResults.length === 0) return "needs_okrs";
  if (atRisk.atRisk) return "at_risk";
  if (gaps.length > 0) return "needs_shaping";
  return "on_track";
}

/** Build one initiative's lane — the OKR/tending/lens rollup shared by the deck
 *  (grouped by quarter) and the Groom wall (every open bet, quarter or not). */
export function buildInitiativeLane(d: VerticalData, i: Initiative, now: Date): InitiativeLane {
  const gaps = lensGaps(d, "initiative", i, now);
  const atRisk = initiativeAtRisk(d, i, now);
  const lane: InitiativeLane = {
    initiative: i,
    state: laneState(i, gaps, atRisk),
    attainment: initiativeAttainment(d, i),
    krCount: i.keyResults.length,
    uncovered: uncoveredKeyResults(d, i).length,
    atRisk,
    gaps,
    needsDomain: !i.domainId || !domainById(d, i.domainId),
    quarterIdx: null,
    overdue: false,
  };
  if (i.targetDate) {
    lane.quarterIdx = targetQuarterIdx(i.targetDate, now);
    lane.overdue = quarterSerial(new Date(i.targetDate + "T12:00:00")) < quarterSerial(now);
  }
  return lane;
}

/** Every open, in-flight bet as a lane — the Groom wall's source (grooming is a
 *  defining/measuring concern, so it spans bets whether or not they have a
 *  quarter yet, unlike the deck which only places the ones with a finish line). */
export function allOpenInitiativeLanes(d: VerticalData, now: Date): InitiativeLane[] {
  return d.initiatives
    .filter((i) => isOpenStatus(i.status) && !isProjectComplete(i.status))
    .map((i) => buildInitiativeLane(d, i, now));
}

/** Read the whole initiative On Deck board in one pass. */
export function readInitiativeDeck(
  d: VerticalData,
  now: Date,
  horizonQuarters: number = HORIZON_QUARTERS,
): InitiativeDeckBoard {
  const thisStart = startOfQuarter(now);

  const quarters: QuarterColumn[] = [];
  for (let i = 0; i < horizonQuarters; i++) {
    const start = addQuarters(thisStart, i);
    quarters.push({
      idx: i,
      start,
      end: endOfQuarter(start),
      key: quarterName(start),
      label: i === 0 ? "This quarter" : i === 1 ? "Next quarter" : quarterName(start),
      shortLabel: quarterName(start),
    });
  }

  const open = d.initiatives.filter(
    (i) => isOpenStatus(i.status) && !isProjectComplete(i.status),
  );

  const lanes: InitiativeLane[] = [];
  const inbox: Initiative[] = [];

  for (const i of open) {
    if (!i.targetDate) inbox.push(i);
    else lanes.push(buildInitiativeLane(d, i, now));
  }

  return { quarters, lanes, inbox, horizonQuarters };
}

// ── Domain auto-link — "which main does this bet belong under?" ───────────────
// A deterministic keyword-overlap heuristic: score every domain by how many
// meaningful tokens it shares with the initiative's name + outcome + description,
// weighted so a domain's own name/charter carry the most signal. No LLM — stable,
// testable, and instant; the accept is one tap, so a wrong guess costs nothing.

const STOP = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "your", "our",
  "are", "was", "will", "have", "has", "not", "you", "all", "any", "can", "get",
  "make", "more", "new", "out", "how", "why", "what", "when", "who", "its",
  "a", "an", "of", "to", "in", "on", "by", "is", "it", "as", "at", "be", "or",
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 3 && !STOP.has(w),
  );
}

// What text represents a domain is one rule, shared with the LLM routers — see
// `domainCorpus` in the routing kernel. It repeats the name so an exact mention
// dominates, and deliberately excludes counter-exemplars (the phrases a domain
// should LOSE on; scoring them here would make a near-miss win).

/** Best-guess domain for any free text (a project/initiative's name + outcome +
 *  description), or null when nothing clears the bar. Instant and offline — the
 *  same token-overlap matcher the initiative deck routes on, factored out so the
 *  Shipped wall can propose a home for loose, already-finished work. Returns the
 *  score so the UI can hedge weak matches. */
export function suggestDomainForText(
  d: VerticalData,
  text: string,
): { domain: Domain; score: number } | null {
  if (d.domains.length === 0) return null;
  const tokens = new Set(tokenize(text));
  if (tokens.size === 0) return null;
  const lower = text.toLowerCase();

  let best: { domain: Domain; score: number } | null = null;
  for (const dom of d.domains) {
    const domSet = new Set(tokenize(domainCorpus(dom)));
    if (domSet.size === 0) continue;
    let score = 0;
    for (const t of tokens) if (domSet.has(t)) score += 1;
    // a direct name mention is decisive
    if (lower.includes(dom.name.toLowerCase()) && dom.name.length >= 3) score += 3;
    if (!best || score > best.score) best = { domain: dom, score };
  }
  // require at least one real overlap to make a suggestion
  return best && best.score >= 1 ? best : null;
}

/** Best-guess domain for an unlinked (or any) initiative, or null when nothing
 *  clears the bar. Thin wrapper over {@link suggestDomainForText}. */
export function suggestDomainForInitiative(
  d: VerticalData,
  i: Initiative,
): { domain: Domain; score: number } | null {
  return suggestDomainForText(d, `${i.name} ${i.outcome} ${i.description}`);
}

function initiativeCorpus(i: Initiative): string {
  // repeat the name so an exact name mention dominates, same as domainCorpus
  return `${i.name} ${i.name} ${i.outcome} ${i.description}`;
}

/** A confident ROUTE for a project — the domain and/or initiative it belongs
 *  under, or nulls. Offline token-overlap (same matcher as the deck), and only
 *  returns a suggestion that (a) clears a real confidence bar and (b) *differs*
 *  from where the project already sits — so "Groom" only ever proposes a genuine
 *  move, never re-confirms the current home. A direct name mention (+3) alone
 *  clears the bar. */
export function suggestRouteForProject(
  d: VerticalData,
  p: Project,
): {
  domain: { domain: Domain; score: number } | null;
  initiative: { initiative: Initiative; score: number } | null;
} {
  const BAR = 3;
  const text = `${p.name} ${p.outcome} ${p.description}`;
  const tokens = new Set(tokenize(text));
  const lower = text.toLowerCase();

  const domHit = suggestDomainForText(d, text);
  const domain = domHit && domHit.score >= BAR && domHit.domain.id !== p.domainId ? domHit : null;

  let bestInit: { initiative: Initiative; score: number } | null = null;
  if (tokens.size > 0) {
    for (const i of d.initiatives) {
      const iSet = new Set(tokenize(initiativeCorpus(i)));
      if (iSet.size === 0) continue;
      let score = 0;
      for (const t of tokens) if (iSet.has(t)) score += 1;
      if (lower.includes(i.name.toLowerCase()) && i.name.length >= 3) score += 3;
      if (!bestInit || score > bestInit.score) bestInit = { initiative: i, score };
    }
  }
  const initiative =
    bestInit && bestInit.score >= BAR && bestInit.initiative.id !== p.initiativeId ? bestInit : null;

  return { domain, initiative };
}
