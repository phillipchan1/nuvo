/**
 * The crown's line (D-207, docs/rail-line.md §4) — the one place Nuvo speaks on
 * a planner page.
 *
 * It is the FIRST card of that page's Get ready stack, said in words, with
 * where it goes: "◌ 2 blocks today didn't happen · Get ready ›". It never ranks
 * anything itself — the stack's composer already put the worst first — so the
 * line and the stack can't disagree. A second card of a *different* kind may
 * ride under it as one faint "then:" clause; never a third, never a count of
 * the stack (P4).
 *
 * Pure: no React, no clock of its own.
 */

/** `warn` — something broke or is at risk · `accent` — intent · `muted` — a read. */
export type CrownLineTone = "warn" | "accent" | "muted";

export interface CrownLineData {
  tone: CrownLineTone;
  /** ◌ missed · ↯ a meeting landed · null for none */
  glyph: string | null;
  /** the fact — truncates when long; the act never does */
  text: string;
  /** the act's words ("Get ready", "Open Trading") — drawn with a › */
  act: string;
  /** one faint "then:" clause, or null */
  then: string | null;
}

/** The part of the stack a card belongs to, for the "then:" rule: a second card
 *  of the SAME part says nothing new. */
export type CardPart = "repair" | "time" | "file" | "shape" | "memory";

export interface LineCard {
  part: CardPart;
  /** what the line says when this card is first */
  fact: string;
  /** what the line says when this card is second ("then: …") */
  then: string;
  tone: CrownLineTone;
  glyph?: string | null;
}

/** First card → the line; the next card of another part → its "then:". */
export function lineFrom(cards: readonly LineCard[], act = "Get ready"): CrownLineData | null {
  const first = cards[0];
  if (!first) return null;
  const second = cards.find((c) => c.part !== first.part) ?? null;
  return { tone: first.tone, glyph: first.glyph ?? null, text: first.fact, act, then: second ? second.then : null };
}

/** "1 block" / "3 blocks". */
export const blocks = (n: number) => (n === 1 ? "1 block" : `${n} blocks`);
