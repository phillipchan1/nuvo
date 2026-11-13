// Momentum — the JS half of the motion vocabulary (the CSS half, and the
// grammar's tokens, are src/styles/momentum.css; the law is
// docs/design-language.md § Momentum).
//
// WAAPI rather than CSS classes for the motions that start FROM a value the
// DOM only knows at the moment of the act — a fill advancing from where it
// was, a block settling where it was dropped. A class can't carry "from 3/7",
// and restarting a CSS animation means remounting the element. `Element.animate`
// is also what `LensZoom` uses, for the same reason, and it is observable in a
// test.
//
// Every helper reads its duration and easing from the MATERIAL's tokens, so
// each skin expresses the same motion in its own idiom — Paper's spring,
// Blueprint's linear plotter, Terminal's stepped cells — and E-ink, whose
// ladder is 1ms, never starts one at all.

/** Below this, a material is not moving — E-ink's 1ms ladder, or a test
 *  environment with no stylesheet. Treated exactly like reduced motion. */
const STILL_MS = 30;

function root(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

/** A custom property, resolved on <html> (where the skin's tokens live). */
export function motionToken(name: string): string {
  const el = root();
  if (!el || typeof getComputedStyle !== "function") return "";
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Parse a CSS time — "352ms", "0.35s", or the unevaluated
 *  "calc(220ms * 1.6)" an engine without `@property` hands back. */
export function parseTime(v: string): number {
  if (!v) return 0;
  const plain = /^(-?[\d.]+)(ms|s)$/.exec(v);
  if (plain) return Number(plain[1]) * (plain[2] === "s" ? 1000 : 1);
  const calc = /^calc\(\s*(-?[\d.]+)(ms|s)\s*\*\s*([\d.]+)\s*\)$/.exec(v);
  if (calc) return Number(calc[1]) * (calc[2] === "s" ? 1000 : 1) * Number(calc[3]);
  return 0;
}

/** A duration token in ms — 0 when the material doesn't define it. */
export function motionMs(name: string): number {
  return parseTime(motionToken(name));
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** True when nothing should move: the user asked for reduced motion, or the
 *  material's own ladder says it doesn't move (E-ink). */
export function motionOff(): boolean {
  if (prefersReducedMotion()) return true;
  return motionMs("--d-land") < STILL_MS;
}

function play(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  durationToken: string,
  easingToken: string,
  delay = 0,
): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== "function" || motionOff()) return null;
  const duration = motionMs(durationToken);
  if (duration < STILL_MS) return null;
  const easing = motionToken(easingToken) || "ease-out";
  try {
    return (el as HTMLElement).animate(keyframes, { duration, easing, delay, fill: "backwards" });
  } catch {
    // An engine that can't parse the material's easing (an old WebKit and
    // `linear()`) still gets the motion, on the plain curve.
    try {
      return (el as HTMLElement).animate(keyframes, { duration, easing: "ease-out", delay, fill: "backwards" });
    } catch {
      return null;
    }
  }
}

/** LAND — a block you placed settles where you put it: a short drop from just
 *  above, carried by the material's land easing (Paper overshoots a hair and
 *  rests; Terminal clicks in; Blueprint draws straight down). Transform only. */
export function landBlock(el: Element | null | undefined): Animation | null {
  return play(
    el,
    [{ transform: "translateY(-6px)" }, { transform: "translateY(0)" }],
    "--d-land",
    "--ease-land",
  );
}

/** LAND — a mark becomes true (a pip fills, a track completes): it arrives
 *  small and lands at its size. */
export function landMark(el: Element | null | undefined, from = 0.4): Animation | null {
  return play(el, [{ transform: `scale(${from})` }, { transform: "scale(1)" }], "--d-land", "--ease-land");
}

/** ADVANCE — a fill catches up from where it was to where it is. Forward only:
 *  the caller snaps a reversal (an undo is not momentum). `from`/`to` are
 *  fractions of the track; the fill element is drawn at `to` and scaled back. */
export function advanceFill(el: Element | null | undefined, from: number, to: number): Animation | null {
  if (!(to > from) || to <= 0) return null;
  const start = Math.max(0, Math.min(1, from / to));
  return play(
    el,
    [{ transform: `scaleX(${start})` }, { transform: "scaleX(1)" }],
    "--d-advance",
    "--ease-momentum",
  );
}

/** ADVANCE, segmented — a newly filled piece of a track grows in from its
 *  left edge, the nth one a stagger beat after the last. */
export function advanceSegment(el: Element | null | undefined, nth = 0): Animation | null {
  return play(
    el,
    [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    "--d-land",
    "--ease-momentum",
    nth * motionMs("--d-stagger"),
  );
}

// ── one block, once ─────────────────────────────────────────────────────────
// A drop is written, then the calendar re-renders the block — sometimes the
// same element, sometimes a fresh one once the optimistic write lands. The
// drop handler marks the block; whichever element draws it first consumes the
// mark and lands. A mark nobody consumes expires, so a block that re-renders
// for any other reason later never "lands" again.

const pending = new Map<string, number>();
const LANDING_TTL_MS = 1500;

export function markLanding(key: string | null | undefined): void {
  if (!key || motionOff()) return;
  pending.set(key, Date.now());
}

export function consumeLanding(key: string | null | undefined): boolean {
  if (!key) return false;
  const at = pending.get(key);
  if (at === undefined) return false;
  pending.delete(key);
  return Date.now() - at <= LANDING_TTL_MS;
}
