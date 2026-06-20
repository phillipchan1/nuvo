// The week's emblem — a celestial, generative mark that *is* the week's data.
//
// Two rules from the spec keep this honest:
//   1. It is a PURE function of a tiny spec (~30 numbers derived from rows). No
//      data fetching, no hooks, no `Math.random` / `Date.now` — so a stored spec
//      regenerates identically forever (the archive is the product).
//   2. The picture is the data, symbolically: sun = the week's dominant bet,
//      concentric rings = domains (arc sweep ∝ hours), satellites = priorities
//      (filled = landed, half-moon = carried, open ring = open), faint dots =
//      ambient done-work, a barely-there ember = a quiet domain (conscience is
//      picture-only — no scolding sentence).
//
// `state` lets the same mark render `forming` (mid-week, watched filling) or
// `sealed` (Friday, the reveal). renderEmblem(spec, state) → SVG.

/** A priority light orbiting the sun. */
export interface EmblemSatellite {
  /** landed = filled disc · carried = half-moon · open = open ring. */
  state: "landed" | "carried" | "open";
  /** orbital angle in degrees (0 = top, clockwise) — deterministic from index. */
  angle: number;
}

/** One domain, drawn as a concentric ring. */
export interface EmblemRing {
  /** the domain's semantic color string (token or hex from the row). */
  color: string;
  /** hours invested as a fraction of the week's busiest domain (0–1). */
  sweep: number;
  /** the domain's weekly target as the same fraction (the faint track). */
  targetSweep: number;
  /** a quiet domain — drawn as a faint ember, no sweep. */
  ember: boolean;
}

/** ~30 numbers, all derived from the week's rows. The emblem is a pure function of this. */
export interface EmblemSpec {
  /** the dominant-hours domain → the central sun. */
  sun: { color: string; intensity: number }; // intensity 0–1 (share of total hours)
  /** domains, outer → inner does not matter; index order is the ring order. */
  rings: EmblemRing[];
  /** the week's priorities. */
  satellites: EmblemSatellite[];
  /** ambient done-count → faint scattered dots (capped when drawn). */
  ambient: number;
  /** deterministic per-week jitter seed (from the week-start date, never random). */
  seed: number;
}

export type EmblemState = "forming" | "sealed";

// ── Deterministic PRNG (mulberry32) ────────────────────────────────────────
// Seeded so the scatter is stable for a given week. NOT Math.random — a stored
// spec must redraw pixel-identically.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable integer seed from a 'YYYY-MM-DD' week-start (no randomness). */
export function seedFromWeek(weekStartISO: string): number {
  let h = 2166136261;
  for (let i = 0; i < weekStartISO.length; i++) {
    h ^= weekStartISO.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Lay N priorities around the orbit deterministically (evenly, with a seeded offset). */
export function satelliteAngles(count: number, seed: number): number[] {
  if (count <= 0) return [];
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const offset = rng() * 360;
  return Array.from({ length: count }, (_, i) => (offset + (i * 360) / count) % 360);
}
