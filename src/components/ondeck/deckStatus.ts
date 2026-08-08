// What a deck card SAYS — one place, so the desktop deck and the phone deck can
// never disagree about whether a project is overdue or a bet needs OKRs. The card
// itself (DeckCard.tsx) only knows how to render a word and some pips; this is the
// judgement about which word.
//
// The rule both altitudes follow: **one status, by precedence, and null when there
// is nothing to say.** A card that says three things says none (Principle 8), and a
// wall that speaks only when something is wrong is what makes the exceptions
// legible (Principle 9).

import type { DeckTone } from "./DeckCard";
import type { OnDeckLane, ReadyTier } from "../../lib/onDeck";
import type { InitiativeLane, InitiativeLaneState } from "../../lib/initiativeDeck";

export type DeckStatus = { label: string; tone: DeckTone } | null;

/** Readiness pip colour by tier — teal = ready, amber = mid-groom, faint = raw. */
export const PIP_TONE: Record<ReadyTier, DeckTone> = {
  ready: "ready",
  grooming: "caution",
  raw: "muted",
  parked: "muted",
  done: "ready",
};

export const INITIATIVE_STATE_LABEL: Record<InitiativeLaneState, string> = {
  on_track: "on track",
  at_risk: "at risk",
  needs_okrs: "needs OKRs",
  needs_shaping: "needs shaping",
  idea: "no finish line",
  parked: "parked",
  done: "shipped",
};

/** A project's one word.
 *
 *  Everything here is a FACT about the row (a passed date, a missing outcome, a week
 *  that can't hold it). Deliberately absent: the pace read. `behind` and `stalled`
 *  fire on almost every honest project the moment it's dated and hasn't been touched
 *  in the trailing window — so a wall of "behind" says nothing, and "no motion"
 *  dresses *absence of history* up as bad news, which is the exact thing Principle
 *  6's corollary forbids. Drift belongs where it can be explained (the record,
 *  Groom), not as a permanent orange word on a planning card. */
export function projectCardStatus(l: OnDeckLane): DeckStatus {
  if (l.readyTier === "done") return { label: "shipped", tone: "ready" };
  if (l.readyTier === "parked") return { label: "parked", tone: "muted" };
  const over = l.pace.read === "overdue" ? l.pace.driftDays : null;
  if (over != null && over > 0) return { label: `${over}d overdue`, tone: "signal" };
  // The FIRST gap only. "no outcome · no steps" is two sentences in a slot that
  // holds one, and the pips already say how many checks are open — the word only
  // has to name where to start.
  if (l.gaps.length) return { label: l.gaps[0].label, tone: "caution" };
  if (l.axes.fits === false) return { label: "won't fit", tone: "caution" };
  return null;
}

/** A bet's one word — same precedence shape, one altitude up. */
export function initiativeCardStatus(lane: InitiativeLane): DeckStatus {
  if (lane.state === "done") return { label: "shipped", tone: "ready" };
  if (lane.state === "parked") return { label: "parked", tone: "muted" };
  if (lane.overdue) return { label: "overdue", tone: "signal" };
  if (lane.state === "at_risk") return { label: INITIATIVE_STATE_LABEL.at_risk, tone: "signal" };
  if (lane.gaps.length) return { label: lane.gaps[0].label, tone: "caution" };
  if (lane.state === "needs_okrs" || lane.state === "idea")
    return { label: INITIATIVE_STATE_LABEL[lane.state], tone: "caution" };
  return null;
}

/** A bet's weight isn't hours — it's how measured it is. Key results are the unit,
 *  and attainment is the one *measured* number a bet has (Principle 6), so it shows
 *  only when there are KRs to average. Never a guess. */
export function initiativeWeight(lane: InitiativeLane): string | null {
  if (lane.krCount === 0) return null;
  const krs = `${lane.krCount} KR${lane.krCount === 1 ? "" : "s"}`;
  return lane.attainment == null ? krs : `${krs} · ${Math.round(lane.attainment * 100)}%`;
}
