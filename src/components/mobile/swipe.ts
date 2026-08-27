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
export const AXIS_RATIO = 2;
/** Travel before we lock onto an axis (still a tap below this). */
export const AXIS_SLOP_PX = 8;
/** A short flick can commit even if it didn't travel a third of the page. */
const FLICK_MS = 280;
const FLICK_PX = 28;

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

/** Live displacement of an in-progress swipe, from the current pointer. */
export function swipeOffset(
  tr: SwipeTracker | null,
  clientX: number,
  clientY: number,
): { dx: number; dy: number } {
  if (!tr) return { dx: 0, dy: 0 };
  return { dx: clientX - tr.x, dy: clientY - tr.y };
}

/**
 * Lock onto an axis once travel clears the slop. Horizontal must be clearly
 * dominant (same 2:1 as `endSwipe`) so a diagonal scroll doesn't steal a page.
 */
export function lockAxis(dx: number, dy: number, slop = AXIS_SLOP_PX): "h" | "v" | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return null;
  if (Math.abs(dx) >= AXIS_RATIO * Math.abs(dy)) return "h";
  if (Math.abs(dy) >= AXIS_RATIO * Math.abs(dx)) return "v";
  return null;
}

/**
 * Should this horizontal release turn the page? A third of the pager (or the
 * standing 48px flick, whichever is larger) commits; so does a short decisive
 * flick that didn't travel that far. The finger-follow pager uses this instead
 * of `endSwipe`, because `endSwipe` also requires the 400ms cap — a slow drag
 * across half the screen is still a page, just a careful one.
 */
export function shouldCommitPage(dx: number, width: number, elapsedMs: number): boolean {
  if (width <= 0) return Math.abs(dx) >= SWIPE_PX;
  if (Math.abs(dx) >= Math.max(SWIPE_PX, width * 0.22)) return true;
  if (elapsedMs < FLICK_MS && Math.abs(dx) >= FLICK_PX) return true;
  return false;
}
