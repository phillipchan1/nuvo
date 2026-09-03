import type { CalendarBlockInput } from "./syncCalendarEvents";

/** Whether a FullCalendar reconcile should run now or wait until the gesture ends. */
export function gridSyncPlan(
  paused: boolean,
  next: readonly CalendarBlockInput[],
): { run: boolean; stash: readonly CalendarBlockInput[] | null } {
  if (paused) return { run: false, stash: next };
  return { run: true, stash: null };
}
