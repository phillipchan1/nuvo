/**
 * "Take me to that day."
 *
 * Search can now find a calendar event, and landing on one means moving the
 * grid to its date — which the grid owns internally (FullCalendar's own API on
 * the desktop, `MobileCalendar`'s date state on the phone). Threading a
 * one-shot "go here" through Planner → CalendarPane as a prop would mean a
 * prop that is a *signal*, not state: it has to fire again for the same value
 * (searching the same meeting twice), which props don't do without a nonce.
 *
 * So it is a tiny bus, in the spirit of `announce.ts` and the ⌥Space panel's
 * `SPOTLIGHT_NAVIGATE_EVENT`: one publisher, whichever calendar is mounted
 * subscribes. Both shells use the same one, so a search result lands the same
 * way on a phone as on a desktop.
 */

export interface CalendarReveal {
  /** Local `YYYY-MM-DD` to bring into view. */
  dateISO: string;
  /** The event to open once the range holding it has loaded. */
  eventId?: string;
  /** Local `HH:MM:SS` to scroll the day into view at.
   *
   *  `gotoDate` alone is a no-op whenever the target is already on screen —
   *  which, in the week view, is most of the time. A reveal that does nothing
   *  visible is a dead affordance, and the rail crown's time chip is exactly
   *  that reveal's front door ("Tue 7:15am ↗"), so the moment travels with the
   *  day and the grid scrolls to it. Optional: a reveal that only knows a date
   *  (search landing on an all-day event) simply doesn't send one. */
  scrollToTime?: string;
  /** Distinguishes two reveals of the same date — see the header. */
  nonce: number;
}

let latest: CalendarReveal | null = null;
let seq = 0;
const subscribers = new Set<(r: CalendarReveal) => void>();

export function revealOnCalendar(target: Omit<CalendarReveal, "nonce">) {
  latest = { ...target, nonce: ++seq };
  for (const fn of subscribers) fn(latest);
}

export function onCalendarReveal(fn: (r: CalendarReveal) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * The reveal a calendar that mounted *after* the publish should still honour —
 * search on the phone opens the Calendar tab, so the grid subscribes a frame
 * too late to hear it live.
 */
export function pendingCalendarReveal(): CalendarReveal | null {
  return latest;
}

export function clearCalendarReveal() {
  latest = null;
}
