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
  type VerticalData,
} from "./vertical";
import { lensGaps, type LensGap } from "./lenses";

/** Concrete quarter columns before the "Later" overflow bucket (this + next 3). */
export const HORIZON_QUARTERS = 4;

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The finish-line date for an initiative placed in a quarter — its last day. */
export const quarterEndISO = (start: Date) => toISO(endOfQuarter(start));

/** A quarter's short name, e.g. "Q3 2026". */
export const quarterName = (d: Date) => `Q${getQuarter(d)} ${getYear(d)}`;

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
  /** the overflow bucket that gathers everything beyond the concrete horizon. */
  later: boolean;
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
 *  ≥ HORIZON_QUARTERS out → HORIZON_QUARTERS (the "Later" bucket). */
export function targetQuarterIdx(targetISO: string, now: Date): number {
  const target = new Date(targetISO + "T12:00:00");
  const diff = quarterSerial(target) - quarterSerial(now);
  if (diff < 0) return 0;
  if (diff >= HORIZON_QUARTERS) return HORIZON_QUARTERS;
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
      later: false,
    });
  }
  // the overflow bucket — everything beyond the concrete horizon
  const laterStart = addQuarters(thisStart, horizonQuarters);
  quarters.push({
    idx: horizonQuarters,
    start: laterStart,
    end: endOfQuarter(laterStart),
    key: "later",
    label: "Later",
    shortLabel: "Later",
    later: true,
  });

  const open = d.initiatives.filter(
    (i) => isOpenStatus(i.status) && !isProjectComplete(i.status),
  );

  const lanes: InitiativeLane[] = [];
  const inbox: Initiative[] = [];

  for (const i of open) {
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
    if (!i.targetDate) {
      inbox.push(i);
    } else {
      const idx = targetQuarterIdx(i.targetDate, now);
      const target = new Date(i.targetDate + "T12:00:00");
      lane.quarterIdx = idx;
      lane.overdue = quarterSerial(target) < quarterSerial(now);
      lanes.push(lane);
    }
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

function domainCorpus(dom: Domain): string {
  const entities = dom.context?.entities?.join(" ") ?? "";
  const keywords = dom.context?.keywords?.join(" ") ?? "";
  const scope = dom.context?.scope ?? "";
  // the name/charter/intention are the routing source of truth — repeat the name
  // so an exact name mention dominates.
  return `${dom.name} ${dom.name} ${dom.charter} ${dom.intention} ${scope} ${entities} ${keywords}`;
}

/** Best-guess domain for an unlinked (or any) initiative, or null when nothing
 *  clears the bar. Returns the score so the UI can hedge weak matches. */
export function suggestDomainForInitiative(
  d: VerticalData,
  i: Initiative,
): { domain: Domain; score: number } | null {
  if (d.domains.length === 0) return null;
  const betTokens = new Set(tokenize(`${i.name} ${i.outcome} ${i.description}`));
  if (betTokens.size === 0) return null;

  let best: { domain: Domain; score: number } | null = null;
  for (const dom of d.domains) {
    const domTokens = tokenize(domainCorpus(dom));
    if (domTokens.length === 0) continue;
    // count how many distinct bet tokens the domain corpus contains
    const domSet = new Set(domTokens);
    let score = 0;
    for (const t of betTokens) if (domSet.has(t)) score += 1;
    // a direct name mention is decisive
    if (i.name.toLowerCase().includes(dom.name.toLowerCase()) && dom.name.length >= 3) score += 3;
    if (!best || score > best.score) best = { domain: dom, score };
  }
  // require at least one real overlap to make a suggestion
  return best && best.score >= 1 ? best : null;
}
