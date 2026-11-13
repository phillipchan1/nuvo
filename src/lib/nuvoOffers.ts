/**
 * What the Nuvo panel offers on the page beside it (D-198) — the pure half.
 *
 * The panel serves ledger rows, not a feature: each kind of offer names the
 * row it turns from hidden into offered (the ledger's ◐ is "the answer exists
 * but is hidden"). Two kinds today:
 *
 *   path    — a thin path (D-196): time held, too little work in it. → Q4
 *   memory  — something Memory is sure enough to ask about (D-194). → W1 · W7
 *
 * Rules that hold for every offer: a few at most (never a list to work
 * through, P4/P9), each with its evidence (P6), nothing written until you act
 * (P3), and a "Not now" that holds for two weeks. No count is ever shown — the
 * door wears one dot, spent by looking.
 *
 * Pure: no React, no storage. The hook passes the snoozed and seen sets in.
 */

import type { ThinPath } from "./thinPath";
import { thinChip } from "./thinPath";

export type OfferKind = "path" | "memory";

export interface OfferMemory {
  key: string;
  statement: string;
  evidence: string;
  keep: string;
}

export interface Offer {
  /** Stable across renders and sessions: what "seen" and "Not now" remember. */
  key: string;
  kind: OfferKind;
  /** The ledger row it serves — every offer must name one (D-198). */
  row: "Q4" | "W1";
  /** The card's kind line. One word per kind, no panel heading (P11). */
  label: string;
  statement: string;
  evidence: string;
  /** What the act does, said before you press it. */
  does: string;
  projectId?: string;
  memoryKey?: string;
}

/** Three at most: a panel is not a queue. */
export const OFFERS_MAX = 3;
/** Memory asks at most two at a time — the question budget (memory.md §13.2). */
export const MEMORY_OFFERS_MAX = 2;
/** "Not now" holds this long. */
export const SNOOZE_DAYS = 14;

const DAY_MS = 86_400_000;

export function pathOffer(t: ThinPath): Offer {
  return {
    key: `path:${t.projectId}`,
    kind: "path",
    row: "Q4",
    label: "Draft the path",
    statement: `${t.name} has more time held than work to fill it.`,
    evidence: thinChip(t),
    does: "Nuvo drafts the missing steps into its list. Nothing is added until you keep it.",
    projectId: t.projectId,
  };
}

export function memoryOffer(m: OfferMemory): Offer {
  return {
    key: `memory:${m.key}`,
    kind: "memory",
    row: "W1",
    label: "From Memory",
    statement: m.statement,
    evidence: m.evidence,
    does: m.keep,
    memoryKey: m.key,
  };
}

export interface ComposeInput {
  thin: ThinPath[];
  memory: OfferMemory[];
  /** The project on screen, if any. On a project, only its own path is offered,
   *  and Memory (which is about your time, not this project) waits. */
  projectId?: string | null;
  /** key → ISO time it was snoozed. */
  snoozed?: Record<string, string>;
  now?: number;
}

export function isSnoozed(key: string, snoozed: Record<string, string> | undefined, now: number): boolean {
  const at = snoozed?.[key];
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t < SNOOZE_DAYS * DAY_MS;
}

export function composeOffers({ thin, memory, projectId, snoozed, now = Date.now() }: ComposeInput): Offer[] {
  const live = (o: Offer) => !isSnoozed(o.key, snoozed, now);
  if (projectId) {
    return thin.filter((t) => t.projectId === projectId).map(pathOffer).filter(live).slice(0, 1);
  }
  const mem = memory.map(memoryOffer).filter(live).slice(0, MEMORY_OFFERS_MAX);
  const paths = thin.map(pathOffer).filter(live);
  return [...paths, ...mem].slice(0, OFFERS_MAX);
}

/** The door's dot: is anything here you haven't seen yet? Never a count. */
export function hasUnseen(offers: Offer[], seen: readonly string[]): boolean {
  return offers.some((o) => !seen.includes(o.key));
}
