// ── The syntax ramp ────────────────────────────────────────────────────────
// What makes an editor theme recognisable is not its background — it's the
// handful of inks it puts on that background. Dracula without purple keywords
// and green strings is just a dark grey app.
//
// The terminal skin used to collapse every calendar block to one accent, which
// made a full week read as a single tinted wall. Instead we QUANTISE identity
// onto the active scheme's published ramp: each calendar keeps a stable, own
// colour, but it's always one of the six inks the theme actually ships, so the
// week reads like a highlighted buffer.
//
// The class is emitted on every skin (it's inert outside terminal, where no
// --syn-* tokens are defined and the rule doesn't apply), so nothing has to
// branch on the active material at render time.

/** How many inks each terminal scheme declares (--syn-1 … --syn-N). */
export const SYN_STEPS = 6;

/** Stable string hash — FNV-1a. Same key always lands on the same ink. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The ramp class for an identity key (a calendar id, a domain id — anything
 * stable). Returns `syn-1` … `syn-6`; terminal CSS turns that into a fill and
 * a left rule, every other skin ignores it.
 */
export function synClass(key: string | null | undefined): string {
  if (!key) return "syn-6";
  return `syn-${(hash(key) % SYN_STEPS) + 1}`;
}
