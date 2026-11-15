// Other times (docs/offer-rules.md R5 · R13, D-216) — the pure half.
//
// An offer's first answer is the composer's. When it isn't right there is
// always a second: up to two alternatives that each differ for a reason they
// can NAME ("Sooner", "Keeps today light"), each with its own cost, or a time
// you pick yourself on the grid, checked the same way. Three times fifteen
// minutes apart is not a choice — it hands the deciding back — so a candidate
// whose reason repeats an earlier one is dropped.
//
// Pure: the composer's candidates and the week's busy time come in, words
// come out. The live half is `hooks/useOfferChoices`.

import { parseDateISO } from "./dates";

export interface Where {
  dayISO: string;
  startMin: number;
  durationMin: number;
}

/** One thing already on the calendar, in the day's minutes. */
export interface BusyItem {
  title: string;
  dayISO: string;
  startMin: number;
  endMin: number;
}

export interface NamedOption {
  at: Where;
  /** why this one differs from the first answer */
  reason: string;
  /** what it costs, when it costs something (R5) */
  cost: string | null;
}

/** At most this many alternatives beside the first answer (R13). */
export const ALTERNATIVES_MAX = 2;

/** Within this many minutes, a neighbour is "right before" / "straight after". */
const TOUCH_MIN = 10;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (dayISO: string) => WEEKDAY[parseDateISO(dayISO).getDay()];

/** Why `at` differs from `first`, in a few words. */
export function reasonFor(at: Where, first: Where, todayISO: string): string {
  if (at.dayISO === first.dayISO) {
    if (at.startMin < first.startMin) return "Sooner";
    return at.dayISO === todayISO ? "Later today" : `Later ${weekday(at.dayISO)}`;
  }
  if (first.dayISO === todayISO) return "Keeps today light";
  if (at.dayISO === todayISO) return "Today, sooner";
  return at.dayISO < first.dayISO ? "Earlier in the week" : "Later in the week";
}

/** What a placement costs (R5): the meeting it butts against, or null when it
 *  sits in open time with room either side. "Right before" wins — running into
 *  something is the cost you feel. */
export function costFor(at: Where, busy: readonly BusyItem[]): string | null {
  const end = at.startMin + at.durationMin;
  const sameDay = busy.filter((b) => b.dayISO === at.dayISO);
  const overlap = sameDay.find((b) => b.startMin < end && b.endMin > at.startMin);
  if (overlap) return `Overlaps ${overlap.title || "something"}`;
  const before = sameDay
    .filter((b) => b.startMin >= end && b.startMin - end <= TOUCH_MIN)
    .sort((a, b) => a.startMin - b.startMin)[0];
  if (before) return `Right before ${before.title || "something"}`;
  const after = sameDay
    .filter((b) => b.endMin <= at.startMin && at.startMin - b.endMin <= TOUCH_MIN)
    .sort((a, b) => b.endMin - a.endMin)[0];
  if (after) return `Straight after ${after.title || "something"}`;
  return null;
}

/** The composer's candidates, cut to at most two that each differ for a
 *  reason of their own, first answer excluded. */
export function nameAlternatives(first: Where, candidates: readonly Where[], todayISO: string, busy: readonly BusyItem[]): NamedOption[] {
  const out: NamedOption[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (c.dayISO === first.dayISO && c.startMin === first.startMin) continue;
    const reason = reasonFor(c, first, todayISO);
    if (seen.has(reason)) continue;
    seen.add(reason);
    out.push({ at: c, reason, cost: costFor(c, busy) });
    if (out.length >= ALTERNATIVES_MAX) break;
  }
  return out;
}

/** A time you picked yourself, checked like any other (R13): the past can't
 *  be held; anything else says what it costs, or that it's open. */
export function checkPick(at: Where, busy: readonly BusyItem[], now: Date, todayISO: string): { cost: string; past: boolean } {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const past = at.dayISO < todayISO || (at.dayISO === todayISO && at.startMin < nowMin);
  if (past) return { cost: "That time has passed", past: true };
  return { cost: costFor(at, busy) ?? "Open", past: false };
}

/** Snap a picked instant to the quarter hour, as the grid does. */
export function snapPick(start: Date, durationMin: number, dayISO: string): Where {
  const m = start.getHours() * 60 + start.getMinutes();
  return { dayISO, startMin: Math.round(m / 15) * 15, durationMin };
}
