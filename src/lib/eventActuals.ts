// Calendar events → time allocation (actuals).
//
// A meeting that already happened is a real investment of time, the same way a
// completed task block is. These helpers decide *whether* an event counts and
// *which domain* it belongs to, so `buildVertical` can fold attended events into
// the domain gain ledger alongside completed tasks. Mirrors how tasks roll up:
// derived live, nothing stored.
//
// Attendance is read straight off the RSVP — no manual confirmation step:
//   accepted / tentative / null(your own block) → counted
//   declined / needsAction(invited, never replied — the workshop you skipped) → dropped

import type { ExternalEvent } from "./types";

/** Stable across re-sync — external_events.id is reassigned on re-import, this isn't. */
export function eventKey(e: Pick<ExternalEvent, "account_id" | "provider_event_id">): string {
  return `${e.account_id}:${e.provider_event_id}`;
}

/** Key for the calendar→domain map. Composite because `calendar_id` alone isn't
 *  unique — every account's primary calendar is literally id "primary". */
export function calendarKey(e: Pick<ExternalEvent, "account_id" | "calendar_id">): string {
  return `${e.account_id}:${e.calendar_id}`;
}

/** Alias of `eventKey` — the same string, named for the hidden-set call sites. */
export const eventInstanceKey = eventKey;

/** Stable key shared by every instance of a recurring series, or null if the
 *  event isn't part of one (or the master id isn't synced yet). */
export function eventSeriesKey(e: { account_id: string; recurring_event_id?: string | null }): string | null {
  return e.recurring_event_id ? `${e.account_id}:series:${e.recurring_event_id}` : null;
}

/** Is this event hidden — directly, or because its whole series is? */
export function isEventHidden(
  e: { account_id: string; provider_event_id: string; recurring_event_id?: string | null },
  hiddenKeys: Set<string>,
): boolean {
  if (hiddenKeys.size === 0) return false;
  if (hiddenKeys.has(eventInstanceKey(e))) return true;
  const seriesKey = eventSeriesKey(e);
  return seriesKey ? hiddenKeys.has(seriesKey) : false;
}

/**
 * What the user has taken out of the busy math — and therefore out of the
 * actuals ledger too. A hidden calendar is usually a *duplicate* import of one
 * already mapped to a domain (the work calendar mirrored into a personal
 * account); counting both would double every meeting.
 */
export interface ActualsFilter {
  hiddenCalendarIds?: Set<string>;
  hiddenEventKeys?: Set<string>;
}

/** Minutes of wall-clock the event occupied. */
export function eventMins(e: Pick<ExternalEvent, "start_at" | "end_at">): number {
  const ms = new Date(e.end_at).getTime() - new Date(e.start_at).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

/**
 * Did this event actually consume time I can attribute? Past, real (busy,
 * timed), and not one I declined or ignored. `self_rsvp` null = no invite, it's
 * my own block → counts.
 */
export function eventCountsAsActual(
  e: Pick<
    ExternalEvent,
    "start_at" | "end_at" | "all_day" | "busy" | "self_rsvp" | "account_id" | "provider_event_id" | "calendar_id"
  > & { recurring_event_id?: string | null },
  now: Date = new Date(),
  filter?: ActualsFilter,
): boolean {
  if (filter?.hiddenCalendarIds?.has(e.calendar_id)) return false;
  if (filter?.hiddenEventKeys && isEventHidden(e, filter.hiddenEventKeys)) return false;
  if (e.all_day || !e.busy) return false;
  if (new Date(e.end_at).getTime() > now.getTime()) return false; // future / in progress
  const rsvp = e.self_rsvp ?? null;
  if (rsvp === "declined" || rsvp === "needsAction") return false;
  return eventMins(e) > 0;
}

/**
 * Where this event's time goes. The calendar→domain map is the deterministic
 * default (SCE calendar → SCE); for events on unmapped calendars we fall back to
 * the AI router's cached verdict. Null = unattributed (skip the ledger).
 */
export function eventDomainId(
  e: Pick<ExternalEvent, "account_id" | "provider_event_id" | "calendar_id">,
  calendarDomainMap: Record<string, string>,
  routingMap?: Record<string, string>,
): string | null {
  return calendarDomainMap[calendarKey(e)] ?? routingMap?.[eventKey(e)] ?? null;
}
