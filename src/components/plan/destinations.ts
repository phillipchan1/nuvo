// Acts that say where things go (docs/rail-modes.md §4, D-204).
//
// An act's label is its destination — a time, a named place, or a state —
// never an opinion ("Looks good") or a deferral with no place ("Later"). One
// vocabulary for the walk and repair, on both shells. Times are spelled only
// through `at` / `span` (dayPlan.ts, D-122): never a second time format.

import { parseDateISO } from "../../lib/dates";
import { span } from "../mobile/dayPlan";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const instantAt = (dayISO: string, min: number) => {
  const d = parseDateISO(dayISO);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d;
};

type Where = { dayISO: string; startMin: number; durationMin: number };

/** "Tue 10–11am" */
export const whereSpan = (p: Where) =>
  `${DAY[parseDateISO(p.dayISO).getDay()]} ${span(instantAt(p.dayISO, p.startMin), instantAt(p.dayISO, p.startMin + p.durationMin))}`;

/** the walk's ↵ — holds the block where it is */
export const holdLabel = (p: Where) => `Hold ${whereSpan(p)}`;
/** repair's ↵ — moves the broken block to the composer's fit */
export const moveLabel = (p: Where) => `Move to ${whereSpan(p)}`;

export const LET_IT_MOVE = "Let it move";
export const LOOK_LAST = "Look at it last";
export const SPLIT_IN_TWO = "Split in two";
export const LEAVE_IN_PLACE = "Leave it where it is";
/** A block with no project (a run of loose work) has no place to go back to —
 *  it simply leaves the week, so its label is the state. */
export const OUT_OF_WEEK = "Out of the week";

/** "Back to Launch pricing page" — or the state, when there's no project. */
export const backTo = (projectName: string | null | undefined) => (projectName ? { verb: "Back to", name: projectName } : null);
export const backToLabel = (projectName: string | null | undefined) => (projectName ? `Back to ${projectName}` : OUT_OF_WEEK);

/** "Split: 30m Tue · 30m Wed" when both halves' places are known, else "Split in two". */
export const splitLabel = (halves: Where[] | null | undefined) => {
  if (!halves || halves.length !== 2) return SPLIT_IN_TWO;
  return `Split: ${halves.map((h) => `${h.durationMin}m ${DAY[parseDateISO(h.dayISO).getDay()]}`).join(" · ")}`;
};
