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
export function landMark(el: Element | null | undefined, from = 0.4, delayMs = 0): Animation | null {
  return play(el, [{ transform: `scale(${from})` }, { transform: "scale(1)" }], "--d-land", "--ease-land", delayMs);
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
export function advanceSegment(el: Element | null | undefined, nth = 0, delayMs = 0): Animation | null {
  return play(
    el,
    [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    "--d-land",
    "--ease-momentum",
    delayMs + nth * motionMs("--d-stagger"),
  );
}

// ── the Reach — the act climbs one altitude to the bar it moved (D-202) ─────
// You placed loose work (a drag onto the grid, Put in a slot): the block lands
// where you are, and ONE mark — an 8px dot in the domain's hue — arcs from it to
// the project's row in the week crown, where the track's piece then advances.
// It shows where the progress came from; it is not itself progress. Called from
// the act's handler only — never from an effect watching data (a refetch, an
// echo or a write the assistant made is not your act).

/** Where the crown's arrivals are expected, per project — so the track the mark
 *  flies to can hold its Advance until the mark gets there. */
const arrivals = new Map<string, number>();

/** ms until a Reach in flight reaches this project's row (0 when none is). */
export function reachArrivalDelay(projectId: string | null | undefined): number {
  if (!projectId) return 0;
  const at = arrivals.get(projectId);
  if (at === undefined) return 0;
  const left = at - Date.now();
  if (left <= 0) {
    arrivals.delete(projectId);
    return 0;
  }
  return left;
}

function onScreen(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return null;
  return r;
}

/** One fixed-position dot from the centre of `from` to the centre of `to`, on
 *  the Advance duration and easing. Transform and opacity only; removed when it
 *  finishes. Resolves at once — and draws nothing — under reduced motion, on a
 *  still material, or when either end is missing or off-screen. */
export function reachMark(from: Element | null | undefined, to: Element | null | undefined, color: string): Promise<void> {
  if (!from || !to || typeof document === "undefined" || motionOff()) return Promise.resolve();
  const a = onScreen(from);
  const b = onScreen(to);
  if (!a || !b) return Promise.resolve();
  const SIZE = 8;
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const dx = b.left + b.width / 2 - x0;
  const dy = b.top + b.height / 2 - y0;
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = "reach-mark";
  Object.assign(dot.style, {
    position: "fixed",
    left: `${x0 - SIZE / 2}px`,
    top: `${y0 - SIZE / 2}px`,
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    borderRadius: "50%",
    background: color,
    zIndex: "90",
    pointerEvents: "none",
  });
  document.body.appendChild(dot);
  // An arc, not a line: the midpoint rides above the straight path by a share
  // of the distance, so a short hop and a long throw read as the same gesture.
  const lift = Math.min(64, Math.max(16, Math.hypot(dx, dy) * 0.18));
  const anim = play(
    dot,
    [
      { transform: "translate(0, 0) scale(0.6)", opacity: 0 },
      { transform: `translate(${dx * 0.1}px, ${dy * 0.1 - lift * 0.3}px) scale(1)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0 },
    ],
    "--d-advance",
    "--ease-momentum",
  );
  if (!anim) {
    dot.remove();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      dot.remove();
      resolve();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  });
}

/** The crown's visible mark for a project: an open row's track if one is on
 *  screen, else the shut strip's pip, else the row itself. Null when no crown
 *  showing this project is mounted (or it's scrolled away) — then no Reach:
 *  nothing is scrolled or opened to stage an animation. */
export function crownTarget(projectId: string): HTMLElement | null {
  if (typeof document === "undefined" || !projectId) return null;
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-crown-project="${CSS.escape(projectId)}"]`),
  );
  let fallback: HTMLElement | null = null;
  for (const el of all) {
    const track = el.querySelector<HTMLElement>(".pace-track");
    if (track && onScreen(track)) return track;
    if (!fallback && onScreen(el)) fallback = el;
  }
  return fallback;
}

/** The Reach to a project's crown row. One call per project per act; a no-op
 *  when the crown isn't on screen. `color` defaults to the row's own hue. */
export function reachToCrown(from: Element | null | undefined, projectId: string | null | undefined, color?: string | null): Promise<void> {
  if (!from || !projectId || motionOff()) return Promise.resolve();
  const to = crownTarget(projectId);
  if (!to) return Promise.resolve();
  const hue =
    color ||
    to.closest<HTMLElement>("[data-crown-color]")?.getAttribute("data-crown-color") ||
    "var(--accent)";
  arrivals.set(projectId, Date.now() + motionMs("--d-advance"));
  return reachMark(from, to, hue).finally(() => {
    arrivals.delete(projectId);
  });
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

// ── collect — a kept offer flies to where it now lives (D-198) ──────────────
// The one moment the Nuvo panel celebrates, and it celebrates YOUR act: you
// pressed Keep, so the card's ghost lifts, arcs toward its home (Memory's row,
// or the page it changes) and that home lands it with the material's spring.
// One ghost per act, transform and opacity only, gone in about half a second,
// never on an offer that merely appeared (P3, P9, D-187's laws 1–2).

/** The visible element among several candidates (a desktop row and a phone
 *  button can both carry the same landing name; only one is on screen). */
export function landingTarget(name: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-land="${name}"]`));
  return all.find((el) => el.getClientRects().length > 0) ?? null;
}

/** Fly a ghost of `from` into `to`, then land `to`. Resolves when it's over
 *  (at once when motion is off, so callers can always await it). */
export function collectInto(from: Element | null | undefined, to: Element | null | undefined): Promise<void> {
  if (!from || !to || typeof document === "undefined" || motionOff()) {
    if (to && !motionOff()) landMark(to, 0.7);
    return Promise.resolve();
  }
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return Promise.resolve();
  const ghost = from.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("id");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
    margin: "0",
    zIndex: "80",
    pointerEvents: "none",
    transformOrigin: "center center",
  });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const end = Math.max(0.08, Math.min(0.4, b.height / a.height));
  const anim = play(
    ghost,
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      // a short lift first — the pick-up — then the arc home
      { transform: "translate(0, -6px) scale(1.02)", opacity: 1, offset: 0.14 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 28}px) scale(${(1 + end) / 2})`, opacity: 0.95, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0 },
    ],
    "--d-advance",
    "--ease-momentum",
  );
  if (!anim) {
    ghost.remove();
    landMark(to, 0.7);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      ghost.remove();
      landMark(to, 0.7);
      resolve();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  });
}
