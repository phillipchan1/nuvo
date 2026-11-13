/**
 * Nuvo's offers at rest, on the rows they change (D-205, docs/rail-modes.md §3)
 * — the pure half.
 *
 * Three kinds, each a chip on its own row, written as the destination:
 *
 *   path — a thin path (D-196) on the week crown's project row → "Draft the path"
 *   hold — a today task with no time, and Find time has a fit today → "Hold 2–2:30pm"
 *   file — an inbox capture the router has a guess for → "File in Garage studio"
 *
 * The rail is already carrying the crown, its line, Significant and the day, so
 * the offers are held to a BUDGET, decided here and nowhere else: one chip per
 * row, at most three in the desktop rail (two on a phone screen), ranked crown →
 * today → inbox, and nothing past the budget — no "+2 more", no count (P4). A
 * mode that owns the rail (Plan, Repair) shows none: one mode at a time.
 *
 * "Not now" holds an offer off for two weeks (the panel's rule, D-198, kept).
 *
 * Pure: no React, no storage. `useRailOffers` passes the snoozed set in.
 */

export type RailOfferKind = "path" | "hold" | "file";

/** What owns the rail. Only `rest` carries offers. */
export type RailMode = "rest" | "plan" | "repair";

export interface RailOfferCandidate {
  /** Stable across renders and sessions: what "Not now" remembers. */
  key: string;
  kind: RailOfferKind;
  /** The row it rides — one chip per row. */
  rowId: string;
  /** Order inside its kind: the crown's row order, the hold's start minute,
   *  the inbox's position. Lower first. */
  order: number;
}

/** The desktop rail's budget: crown + the face showing, together. */
export const RAIL_OFFERS_MAX = 3;
/** A phone screen's budget. */
export const PHONE_OFFERS_MAX = 2;
/** "Not now" holds this long. */
export const SNOOZE_DAYS = 14;

const DAY_MS = 86_400_000;
const KIND_RANK: Record<RailOfferKind, number> = { path: 0, hold: 1, file: 2 };

export const offerKey = (kind: RailOfferKind, id: string) => `${kind}:${id}`;

export function isSnoozed(key: string, snoozed: Record<string, string> | undefined, now: number): boolean {
  const at = snoozed?.[key];
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t < SNOOZE_DAYS * DAY_MS;
}

export interface BudgetOptions {
  max?: number;
  mode?: RailMode;
  snoozed?: Record<string, string>;
  now?: number;
}

/** The offers that show, ranked: crown → today → inbox, each in its own order;
 *  one per row; snoozed ones skipped; nothing past `max`; nothing at all unless
 *  the rail is at rest. */
export function budgetOffers(
  candidates: readonly RailOfferCandidate[],
  { max = RAIL_OFFERS_MAX, mode = "rest", snoozed, now = Date.now() }: BudgetOptions = {},
): RailOfferCandidate[] {
  if (mode !== "rest" || max <= 0) return [];
  const ranked = candidates
    .filter((c) => !isSnoozed(c.key, snoozed, now))
    .slice()
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.order - b.order);
  const out: RailOfferCandidate[] = [];
  const rows = new Set<string>();
  for (const c of ranked) {
    if (out.length >= max) break;
    if (rows.has(c.rowId)) continue;
    rows.add(c.rowId);
    out.push(c);
  }
  return out;
}

/** The budget as a lookup: row id → the one offer it carries. */
export function offersByRow(kept: readonly RailOfferCandidate[]): Map<string, RailOfferCandidate> {
  return new Map(kept.map((c) => [c.rowId, c]));
}
