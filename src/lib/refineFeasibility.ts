// The Reality-check card's math — the one read only this app can make, because
// only it holds both the work estimate and the live calendar. Pure over busy
// blocks: walks every day from now to the finish line, subtracts what's already
// committed from the work window, and reports how much open time is actually
// left vs. how much the project needs. (docs/refine-run.md §3, the keystone card.)

import { differenceInCalendarDays, startOfDay } from "date-fns";
import type { BusyBlock } from "./now";

export interface Feasibility {
  estHours: number;
  /** total open work hours between now and the finish line. */
  openHours: number;
  /** days with a contiguous ≥90m free stretch in the afternoon. */
  openAfternoons: number;
  daysLeft: number;
  read: "comfortable" | "tight" | "unrealistic";
  reason: string;
}

const AFTERNOON_START_MIN = 13 * 60;
const DEEP_STRETCH_MIN = 90;

// free intervals = the work window minus (clipped, merged) busy blocks, in
// minutes-from-midnight for one day.
function freeIntervals(busyOnDay: [number, number][], wStart: number, wEnd: number): [number, number][] {
  const merged: [number, number][] = [];
  for (const [s, e] of [...busyOnDay].sort((a, b) => a[0] - b[0])) {
    const cs = Math.max(s, wStart), ce = Math.min(e, wEnd);
    if (ce <= cs) continue;
    const last = merged[merged.length - 1];
    if (last && cs <= last[1]) last[1] = Math.max(last[1], ce);
    else merged.push([cs, ce]);
  }
  const free: [number, number][] = [];
  let cursor = wStart;
  for (const [s, e] of merged) {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < wEnd) free.push([cursor, wEnd]);
  return free;
}

export function computeFeasibility(
  busy: BusyBlock[],
  now: Date,
  dueISO: string | null,
  workStartMins: number,
  workEndMins: number,
  estHours: number,
): Feasibility | null {
  if (!dueISO || estHours <= 0) return null;
  const due = new Date(dueISO + "T23:59:59");
  if (Number.isNaN(due.getTime())) return null;
  const daysLeft = differenceInCalendarDays(due, now);
  if (daysLeft < 0) {
    // already overdue — the calendar can't help; let the verdict speak
    return { estHours, openHours: 0, openAfternoons: 0, daysLeft, read: "unrealistic", reason: `${-daysLeft}d overdue · ≈${estHours}h still to do.` };
  }

  const day0 = startOfDay(now).getTime();
  const nowMin = (now.getTime() - day0) / 60000;
  let openMins = 0, openAfternoons = 0;

  for (let d = 0; d <= daysLeft; d++) {
    const dayBase = day0 + d * 86_400_000;
    let wStart = workStartMins, wEnd = workEndMins;
    if (d === 0) wStart = Math.max(wStart, nowMin);
    if (wStart >= wEnd) continue;

    const busyOnDay: [number, number][] = [];
    for (const b of busy) {
      if (b.done) continue;
      const s = (b.start.getTime() - dayBase) / 60000;
      const e = (b.end.getTime() - dayBase) / 60000;
      if (e > 0 && s < 24 * 60) busyOnDay.push([s, e]);
    }

    for (const [s, e] of freeIntervals(busyOnDay, wStart, wEnd)) {
      openMins += e - s;
      const aStart = Math.max(s, AFTERNOON_START_MIN);
      if (e - aStart >= DEEP_STRETCH_MIN) openAfternoons++;
    }
  }

  const openHours = Math.round(openMins / 60);
  const estMins = estHours * 60;
  const read = estMins <= openMins * 0.6 ? "comfortable" : estMins <= openMins ? "tight" : "unrealistic";

  const afternoonPhrase = `${openAfternoons} open afternoon${openAfternoons === 1 ? "" : "s"}`;
  const reason =
    read === "comfortable" ? `≈${estHours}h of work · ${afternoonPhrase} and ~${openHours}h free before it's due. Comfortable.`
    : read === "tight" ? `≈${estHours}h of work · only ${afternoonPhrase} (~${openHours}h) before it's due. Tight.`
    : `≈${estHours}h of work · just ~${openHours}h open before it's due. It won't fit as scoped.`;

  return { estHours, openHours, openAfternoons, daysLeft, read, reason };
}
