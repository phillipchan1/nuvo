// Shared swipe classification for the mobile surfaces that watch for horizontal
// or vertical flicks (the Month grid, the Day lens, the deck pager).
//
// Two failure modes this guards against, both measured on device:
//  - The Month grid fired its drill-in on any upward travel > 48px — which is
//    simply how you scroll a page. A flick must now be fast (<400ms), clearly
//    axis-dominant (2:1), and must not have actually scrolled the enclosing
//    `.mobile-scroll` container.
//  - iOS Safari's left-edge back gesture collides with horizontal swipe nav
//    (`touch-action: pan-y` does not suppress it). Gestures that start within
//    EDGE_GUARD_PX of the left edge are ignored, so the system gesture is never
//    doubled by a half-committed month/day change.

import type React from "react";

/** The strip along the left edge that belongs to the OS back gesture. */
export const EDGE_GUARD_PX = 24;
/** Travel that counts as a deliberate flick. */
export const SWIPE_PX = 48;
/** A flick is fast; anything slower is a scroll or a hesitation. */
const MAX_MS = 400;
/** Dominant-axis ratio — |major| must beat 2×|minor|. */
const AXIS_RATIO = 2;

export interface SwipeTracker {
  x: number;
  y: number;
  t: number;
  edge: boolean;
  scroller: HTMLElement | null;
  scrollTop: number;
  /** the enclosing scroller moved during the touch — it was a scroll. */
  scrolled: boolean;
}

export function startSwipe(e: React.TouchEvent, scroller: HTMLElement | null): SwipeTracker | null {
  const t = e.touches[0];
  if (!t) return null;
  return {
    x: t.clientX,
    y: t.clientY,
    t: Date.now(),
    edge: t.clientX < EDGE_GUARD_PX,
    scroller,
    scrollTop: scroller?.scrollTop ?? 0,
    scrolled: false,
  };
}

/** Call from onTouchMove — marks the gesture as a scroll once the container moves. */
export function trackSwipe(tr: SwipeTracker | null) {
  if (!tr || !tr.scroller || tr.scrolled) return;
  if (Math.abs(tr.scroller.scrollTop - tr.scrollTop) > 1) tr.scrolled = true;
}

export type SwipeDir = "left" | "right" | "up" | "down";

export function endSwipe(tr: SwipeTracker | null, e: React.TouchEvent): SwipeDir | null {
  if (!tr) return null;
  if (tr.edge) return null; // the OS owns edge gestures
  if (tr.scrolled) return null; // the page moved — that was a scroll
  if (Date.now() - tr.t > MAX_MS) return null;
  const t = e.changedTouches[0];
  const dx = (t?.clientX ?? tr.x) - tr.x;
  const dy = (t?.clientY ?? tr.y) - tr.y;
  if (Math.abs(dy) >= AXIS_RATIO * Math.abs(dx)) {
    if (dy <= -SWIPE_PX) return "up";
    if (dy >= SWIPE_PX) return "down";
    return null;
  }
  if (Math.abs(dx) >= AXIS_RATIO * Math.abs(dy)) {
    if (dx <= -SWIPE_PX) return "left";
    if (dx >= SWIPE_PX) return "right";
  }
  return null;
}
