// The one rule that decides whether a calendar sync is allowed to delete.
//
// Pure and zero-import, like the planning kernel, for the same reason: this is
// a rule, not plumbing, and a rule that can't be tested is a rule that quietly
// stops holding. `reconcileEvents` does the I/O; the judgement lives here.
//
// What it protects against: the sweep reads "the provider didn't send it" as
// "it was deleted upstream", which is correct and is the only way a
// no-delta provider (CalDAV, ICS) can ever notice a cancellation. But it means
// a provider that returns *nothing at all* looks exactly like a calendar that
// was emptied — and on 2026-07-27 that cost 293 events: iCloud's CalDAV
// discovery silently returned zero calendars, so zero events were fetched, so
// every stored row was swept, and all 1,022 runs of the broken sync logged
// "ok". The provider layer should catch its own failure first (discoverCalendars
// now throws on an empty list). This is the backstop for the failure nobody
// predicted.

/** Below this many stored rows, a scope going empty is plausible enough to
 *  honour — someone really can delete their last three events. Above it, a
 *  provider reporting nothing is a broken provider, not an empty calendar.
 *  The number is a judgement call; what matters is that it sits well under any
 *  real calendar and well over "I cleared out a couple of things". */
export const EMPTY_SWEEP_FLOOR = 25;

/** Should a sweep be refused?
 *
 *  Deliberately narrow: only the all-or-nothing case. A provider that returns
 *  *some* events and drops others is doing exactly what the sweep exists for,
 *  and a percentage heuristic there would start blocking real deletions. */
export function isSuspectWipe(incomingCount: number, storedCount: number): boolean {
  return incomingCount === 0 && storedCount >= EMPTY_SWEEP_FLOOR;
}
