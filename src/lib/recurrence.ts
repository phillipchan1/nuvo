// Re-export the shared recurrence kernel — one implementation, two runtimes.
export * from "../../supabase/functions/_shared/recurrence.ts";

import { fromGoogleRRULE as decodeRRule, toGoogleRRULE as encodeRRule, type RecurrenceRule as Rule } from "../../supabase/functions/_shared/recurrence.ts";
import { detectDeviceTz } from "./timezone";

/** A calendar EVENT's RRULE, read in the zone it's shown in: its UNTIL is the
 *  last instant of that local day (a DATE for an all-day series). Tasks keep
 *  the zone-free `toGoogleRRULE`. */
export function eventRRule(rule: Rule, allDay = false): string[] {
  return encodeRRule(rule, { tz: detectDeviceTz(), allDay });
}

/** Read an event's RRULE back with its UNTIL as the same local day. */
export function readEventRRule(lines: string[] | null | undefined): Rule | null {
  return decodeRRule(lines, { tz: detectDeviceTz() });
}
