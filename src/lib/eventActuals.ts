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



/** Stable key shared by every instance of a recurring series, or null if the
 *  event isn't part of one (or the master id isn't synced yet). */
export function eventSeriesKey(e: { account_id: string; recurring_event_id?: string | null }): string | null {
  return e.recurring_event_id ? `${e.account_id}:series:${e.recurring_event_id}` : null;
}

/** Google instance ids end with `_YYYYMMDDTHHMMSSZ` (UTC suffix optional). */
export function isGoogleRecurringInstanceId(providerEventId: string): boolean {
  return /_\d{8}T\d{6}Z?$/.test(providerEventId);
}

/** Series master slipped through sync — carries RRULE locally, no recurringEventId. */
export function isGoogleSeriesMasterRaw(
  raw: { recurrence?: string[]; recurringEventId?: string } | null | undefined,
): boolean {
  return Boolean(raw?.recurrence?.length && !raw.recurringEventId);
}

/** Resolve the master series id for hide/edit/delete scope. */
export function resolveRecurringEventId(
  e: Pick<ExternalEvent, "recurring_event_id" | "provider_event_id">,
  opts?: {
    raw?: { recurringEventId?: string } | null;
    provider?: "google" | "m365" | "icloud" | "ics" | null;
  },
): string | undefined {
  if (e.recurring_event_id) return e.recurring_event_id;
  if (opts?.raw?.recurringEventId) return opts.raw.recurringEventId;
  if (opts?.provider === "google" && isGoogleRecurringInstanceId(e.provider_event_id)) {
    const m = e.provider_event_id.match(/^(.+)_\d{8}T\d{6}Z?$/);
    return m?.[1];
  }
  return undefined;
}

/** Is this external event part of a recurring series? */
export function isExternalEventRecurring(
  e: Pick<ExternalEvent, "recurring_event_id" | "provider_event_id">,
  opts?: {
    raw?: { recurrence?: string[]; recurringEventId?: string } | null;
    provider?: "google" | "m365" | "icloud" | "ics" | null;
  },
): boolean {
  if (e.recurring_event_id) return true;
  if (opts?.raw?.recurringEventId) return true;
  if (isGoogleSeriesMasterRaw(opts?.raw)) return true;
  if (e.provider_event_id.includes("::")) return true;
  if (opts?.provider === "google" && isGoogleRecurringInstanceId(e.provider_event_id)) return true;
  return false;
}

/** Is this event hidden — directly, or because its whole series is? */
export function isEventHidden(
  e: { account_id: string; provider_event_id: string; recurring_event_id?: string | null },
  hiddenKeys: Set<string>,
): boolean {
  if (hiddenKeys.size === 0) return false;
  if (hiddenKeys.has(eventKey(e))) return true;
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
