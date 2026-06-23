// Capacity — the denominator side of Commitment, modelled as *load* so the meter
// can tell the whole truth about a week: how much of the work window is already
// eaten by meetings/obligations, how much usable focus remains, and what's left
// after a buffer. Pure over busy blocks (the one "what counts as busy" rule via
// toBusyBlocks). The hook orchestrates trailing-actual vs forward weeks; this file
// is just the per-day/week math. See docs/commitment-model.md.

import { addDays, startOfDay } from "date-fns";
import type { BusyBlock } from "./now";

/** Open stretches shorter than this aren't usable focus time — they're the gaps
 *  between meetings, not a place to move a project forward. */
export const MIN_FOCUS_GAP = 30;
/** Share of the work window held back for admin / email / transitions — never
 *  counted as project-capable capacity. */
export const BUFFER_FRAC = 0.15;

export interface DayLoad {
  windowMins: number; // work-window minutes available this day (0 on weekends / past)
  busyMins: number; // meetings/obligations inside the window
  usableFreeMins: number; // free stretches >= MIN_FOCUS_GAP inside the window
}
export interface WeekLoad extends DayLoad {
  weekStart: Date;
}

const ZERO: DayLoad = { windowMins: 0, busyMins: 0, usableFreeMins: 0 };

/** Busy blocks clipped to [wStart,wEnd] on `dayBase`, merged so overlaps don't double-count. */
function mergedBusy(busy: BusyBlock[], dayBase: number, wStart: number, wEnd: number): [number, number][] {
  const clipped = busy
    .filter((b) => !b.done)
    .map((b): [number, number] => [
      Math.max((b.start.getTime() - dayBase) / 60000, wStart),
      Math.min((b.end.getTime() - dayBase) / 60000, wEnd),
    ])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of clipped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/** Load for one day. Weekends and days before `clipFrom` contribute nothing;
 *  `clipFrom` (= now) also trims the already-elapsed part of today. */
export function dayLoad(busy: BusyBlock[], day: Date, wStartMin: number, wEndMin: number, clipFrom?: Date): DayLoad {
  const dow = day.getDay();
  if (dow === 0 || dow === 6) return ZERO; // Sat/Sun — not work time
  const dayBase = startOfDay(day).getTime();
  let wStart = wStartMin;
  if (clipFrom) {
    const clip0 = startOfDay(clipFrom).getTime();
    if (dayBase < clip0) return ZERO;
    if (dayBase === clip0) wStart = Math.max(wStart, (clipFrom.getTime() - dayBase) / 60000);
  }
  if (wStart >= wEndMin) return ZERO;

  const windowMins = wEndMin - wStart;
  const merged = mergedBusy(busy, dayBase, wStart, wEndMin);
  let busyMins = 0;
  for (const [s, e] of merged) busyMins += e - s;

  let usableFreeMins = 0;
  let cursor = wStart;
  for (const [s, e] of merged) {
    const gap = s - cursor;
    if (gap >= MIN_FOCUS_GAP) usableFreeMins += gap;
    cursor = Math.max(cursor, e);
  }
  const tail = wEndMin - cursor;
  if (tail >= MIN_FOCUS_GAP) usableFreeMins += tail;

  return { windowMins, busyMins, usableFreeMins };
}

/** Load summed across the working days of the week starting `weekStart`. */
export function weekLoad(busy: BusyBlock[], weekStart: Date, wStartMin: number, wEndMin: number, clipFrom?: Date): WeekLoad {
  let windowMins = 0;
  let busyMins = 0;
  let usableFreeMins = 0;
  for (let i = 0; i < 7; i++) {
    const d = dayLoad(busy, addDays(weekStart, i), wStartMin, wEndMin, clipFrom);
    windowMins += d.windowMins;
    busyMins += d.busyMins;
    usableFreeMins += d.usableFreeMins;
  }
  return { weekStart, windowMins, busyMins, usableFreeMins };
}
