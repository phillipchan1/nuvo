/**
 * The thin paths about to land (D-196): projects with time held in the next
 * two weeks and too little work in it. The deck's read of `lib/thinPath` —
 * Plan the week reads the same rule over its own week's slots.
 */
import { useMemo } from "react";
import { addDays } from "date-fns";
import { useVertical } from "./useVertical";
import { useSlots } from "./useSlots";
import { parseDateISO, todayISO } from "../lib/dates";
import { THIN_MARKS_MAX, thinPaths, type ThinPath } from "../lib/thinPath";

/** "About to land" — the window the mark speaks in. */
export const THIN_WINDOW_DAYS = 14;

/** The slot range the deck reads — exported so a harness can seed it. */
export function thinWindow(today: string = todayISO()): { start: string; end: string } {
  const start = parseDateISO(today);
  return { start: start.toISOString(), end: addDays(start, THIN_WINDOW_DAYS).toISOString() };
}

export function useThinPaths(): Map<string, ThinPath> {
  const { data } = useVertical();
  const today = todayISO();
  const range = useMemo(() => thinWindow(today), [today]);
  const { data: slots = [] } = useSlots(range.start, range.end);
  return useMemo(() => new Map(thinPaths(data, slots).slice(0, THIN_MARKS_MAX).map((t) => [t.projectId, t])), [data, slots]);
}
