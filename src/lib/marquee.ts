// Marquee — the agent driving the left canvas. When Nuvo wants to *show* an
// answer rather than only narrate it, it returns a directive: bring a named
// surface forward, then put a target "in the limelight" (a warm orb).
//
// The vocabulary is NOT hardcoded here — it lives in `marqueeRegistry.ts` and is
// sent to the agent on every request, so it grows as the app grows (add a
// registry entry + tag an element; no edge change). These types stay loose
// (string keys) on purpose; the registry is the source of truth, validated at
// runtime. A surface is brought forward via a decoupled window event (some
// surfaces, like Week's Plan, are local component state, not global nav), and a
// target is any element tagged `data-marquee="<key>"`.

/** A surface key — see MARQUEE_SURFACES in marqueeRegistry.ts. */
export type MarqueeSurface = string;
/** A target key — matches a `data-marquee="<key>"` element. */
export type MarqueeTarget = string;

export interface MarqueeSpot {
  target: MarqueeTarget;
  /** For entity targets — the id of the specific item to show (project,
   *  initiative, domain, task). The client resolves it against the registry. */
  ref?: string;
  /** Tiny tag rendered on the orb (e.g. "this week"). */
  label?: string;
}

export interface MarqueeDirective {
  /** Legacy/optional: a surface hint. The client normally resolves the surface
   *  from the registry by target key, so the agent need only send the target. */
  surface?: MarqueeSurface;
  /** What to put in the limelight, in order. */
  spotlight?: MarqueeSpot[];
  /** A short line pinned near the orb (≤ ~8 words). */
  caption?: string;
}

export const MARQUEE_OPEN_EVENT = "nuvo:marquee:open";
export const MARQUEE_CLOSE_EVENT = "nuvo:marquee:close";

/** Ask the shell to bring a surface forward — decoupled from the React tree so
 *  the Marquee controller doesn't need to reach into each surface's local state. */
export function requestMarqueeSurface(surface: MarqueeSurface) {
  window.dispatchEvent(new CustomEvent(MARQUEE_OPEN_EVENT, { detail: { surface } }));
}

/** Undo the surface a directive brought forward (the "← Back" return path). */
export function closeMarqueeSurface(surface: MarqueeSurface) {
  window.dispatchEvent(new CustomEvent(MARQUEE_CLOSE_EVENT, { detail: { surface } }));
}
