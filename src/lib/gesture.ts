// Gesture physics shared by every touch surface — the sheet's drag-to-dismiss,
// the row swipe, the detail stack's edge-swipe back. One definition of
// "resistance" and "a flick", so a sheet and a row feel like the same OS.

export interface VelocitySample {
  /** The tracked coordinate (y for a sheet, x for a row). */
  y: number;
  /** event.timeStamp, ms. */
  t: number;
}

/**
 * UIScrollView's rubber band: travel past an edge is paid back on a curve that
 * approaches `dimension` but never reaches it. `c = 0.55` is UIKit's constant.
 */
export function rubberBand(overshoot: number, dimension: number, c = 0.55): number {
  if (overshoot <= 0) return 0;
  return (1 - 1 / ((overshoot * c) / dimension + 1)) * dimension;
}

/**
 * Release velocity in px/ms from the last few samples (positive = increasing
 * coordinate). Uses the window of the final ~80ms so a finger that paused
 * before lifting reads as slow, the way UIKit's pan recogniser does.
 */
export function releaseVelocity(samples: readonly VelocitySample[], windowMs = 80): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    first = samples[i];
    if (last.t - samples[i].t >= windowMs) break;
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.y - first.y) / dt;
}

/**
 * Past the commit threshold a swipe keeps following the finger, but with
 * resistance — the row still answers, it just tells you you're "there".
 */
export function resistedTravel(dx: number, threshold: number, max: number): number {
  const sign = Math.sign(dx);
  const abs = Math.abs(dx);
  if (abs <= threshold) return dx;
  return sign * (threshold + rubberBand(abs - threshold, Math.max(1, max - threshold)));
}
