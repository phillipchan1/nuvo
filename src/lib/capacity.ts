// Capacity — the denominator of the Commitment ratio. Real available hours, not
// aspiration: the work window minus what the calendar already holds (external
// meetings + scheduled blocks). Pure over busy blocks, the same primitive the
// Reality-check card walks (refineFeasibility.ts), generalized from one finish
// line to a rolling set of weeks so the portfolio meter and the timeline ribbon
// can share it. Capacity is decided calendar-derived — see docs/commitment-model.md.

import { addDays, startOfDay, startOfWeek } from "date-fns";
import type { BusyBlock } from "./now";

export interface WeekCapacity {
  weekStart: Date;
  /** Open work minutes left in the window across the week (current week is clipped to now). */
  availMins: number;
}

/** Free minutes inside [wStartMin, wEndMin] on the day at `dayBase`, after
 *  merging away busy blocks clipped to the window. */
export function freeMinsOnDay(busy: BusyBlock[], dayBase: number, wStartMin: number, wEndMin: number): number {
  if (wStartMin >= wEndMin) return 0;
  const clipped = busy
    .filter((b) => !b.done)
    .map((b): [number, number] => [
      Math.max((b.start.getTime() - dayBase) / 60000, wStartMin),
      Math.min((b.end.getTime() - dayBase) / 60000, wEndMin),
    ])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [s, e] of clipped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const busyMin = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  return wEndMin - wStartMin - busyMin;
}

function dayAvailable(busy: BusyBlock[], day: Date, wStartMin: number, wEndMin: number, clipFrom?: Date): number {
  const dayBase = startOfDay(day).getTime();
  let wStart = wStartMin;
  if (clipFrom) {
    const clip0 = startOfDay(clipFrom).getTime();
    if (dayBase < clip0) return 0; // a day already past — no capacity left in it
    if (dayBase === clip0) wStart = Math.max(wStart, (clipFrom.getTime() - dayBase) / 60000);
  }
  return freeMinsOnDay(busy, dayBase, wStart, wEndMin);
}

/** Open work minutes across the working days of the week starting `weekStart`.
 *  Weekends don't count as work capacity. Pass `clipFrom` (= now) to count only
 *  time still ahead in the current week. */
export function weekCapacityMins(
  busy: BusyBlock[],
  weekStart: Date,
  wStartMin: number,
  wEndMin: number,
  clipFrom?: Date,
): number {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // Sat/Sun — not work time
    total += dayAvailable(busy, day, wStartMin, wEndMin, clipFrom);
  }
  return total;
}

/** Rolling weekly capacity from the week containing `now` forward `weeks` weeks.
 *  The first (current) week is clipped to now; later weeks are full. */
export function capacityByWeek(
  busy: BusyBlock[],
  now: Date,
  weeks: number,
  wStartMin: number,
  wEndMin: number,
  weekStartsOn: 0 | 1,
): WeekCapacity[] {
  const first = startOfWeek(now, { weekStartsOn });
  const out: WeekCapacity[] = [];
  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(first, w * 7);
    out.push({ weekStart, availMins: weekCapacityMins(busy, weekStart, wStartMin, wEndMin, w === 0 ? now : undefined) });
  }
  return out;
}
