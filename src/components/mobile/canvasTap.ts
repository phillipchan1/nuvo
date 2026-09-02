import { AXIS_SLOP_PX } from "./swipe";

// Empty-space tap on the Day canvas (D-130). Apple Calendar, Google Calendar
// and Akiflow all treat a tap in a gap as "claim this time" — they snap to
// the slot the finger is IN (not nearest, which jumps backward just after
// an hour line) and open create with a default length. Nuvo opens the one
// capture door, seeded. The math lives here so a test can prove the snap
// without mounting the grid, the same reason month tap meaning lives in
// `monthTap.ts`.

/** 30 min = 44px — a half-hour block IS a tap target. */
export const DAY_HOUR_PX = 88;

/** Same 15-minute grain the desktop Schedule selects on. */
export const TAP_SNAP_MINS = 15;

/** The 15-minute slot containing a Y on the day canvas, clamped to the
 *  visible window — a tap above 8am claims 8am, not midnight. */
export function minutesFromCanvasY(
  clientY: number,
  canvasTop: number,
  winStart: number,
  hourPx: number = DAY_HOUR_PX,
  step: number = TAP_SNAP_MINS,
  winEnd: number = 24 * 60,
): number {
  const raw = winStart + ((clientY - canvasTop) / hourPx) * 60;
  const snapped = Math.floor(raw / step) * step;
  const last = Math.max(winStart, Math.floor((winEnd - step) / step) * step);
  return Math.max(winStart, Math.min(last, snapped));
}

/** Local midnight of `day`, advanced by `minutes`. */
export function dateAtMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes, 0, 0);
  return d;
}

/** A tap, not a scroll or a page-swipe — same slop TimePager uses to stay idle. */
export function isCanvasTap(dx: number, dy: number, slop: number = AXIS_SLOP_PX): boolean {
  return Math.hypot(dx, dy) <= slop;
}
