import type { CalendarAccount, CalendarInfo, CalendarProvider } from "./types";

// ── Offline: the one write in Nuvo that genuinely cannot be queued ──────────
//
// Everything Nuvo *owns* queues (`SYNC_TABLES` in `lib/sync/ops.ts`): a task
// edited on a plane lands in IndexedDB, merges per-field, and reaches Postgres
// days later. `external_events` is deliberately not on that list, and the audit
// (2026-08-12, calendar row "Offline support & conflict handling") was right
// that the omission is CORRECT and wrong that the app owned up to it.
//
// It is correct because Nuvo does not own these rows. Google and Apple do. The
// `external_events` table is a *cache* of somebody else's truth, and a queued
// local edit would be a promise Nuvo cannot keep: the provider can move,
// cancel or re-title the same event while the device is dark, and there is no
// per-field timestamp coming back from either API to merge against. A queue
// there converts "this didn't save" into "this saved and then silently
// vanished", which is strictly worse.
//
// What was wrong is that the failure arrived as a raw network error in a red
// toast — indistinguishable from a bug, after the user had already typed the
// edit. So the rule is stated here, checked BEFORE any work is done, and shown
// on the editing surfaces while the device is offline. Refusing early and
// saying why is the honest version of a constraint you can't remove.

/** Why a calendar write can't happen right now, or null if it can. Pass the
 *  live `useOnline()` value; `undefined` means "don't know", which is treated
 *  as online (a false refusal is worse than a real failure). */
export function calendarWriteBlockedReason(online?: boolean): string | null {
  if (online === false) {
    return "You're offline. Calendar changes go straight to Google or Apple, so this one can't be saved on the device the way your tasks are — reconnect and try again.";
  }
  return null;
}

/** The short form, for a banner or a disabled control's tooltip. */
export const CALENDAR_OFFLINE_NOTE =
  "Offline — your calendar lives with Google/Apple, so events can't be edited until you reconnect. Tasks still save here.";

/** Throw the reason if a calendar write can't happen. Called at the top of
 *  every event mutation, before anything optimistic — the alternative is
 *  painting the change on screen and then yanking it back. */
export function assertCalendarWritable(online?: boolean): void {
  const reason = calendarWriteBlockedReason(online);
  if (reason) throw new Error(reason);
}

/** Providers Nuvo can write back to (create / move / resize / retitle / delete).
 *  Google via its API; iCloud via CalDAV. M365 and ICS stay read-only. */
export function isWritableProvider(provider: CalendarProvider): boolean {
  return provider === "google" || provider === "icloud";
}

/** Whether an account accepts write-back — a two-way, writable-provider account. */
export function isWritableAccount(
  account?: Pick<CalendarAccount, "provider" | "sync_direction"> | null,
): boolean {
  return Boolean(account && account.sync_direction === "two_way" && isWritableProvider(account.provider));
}

/** The edge function that owns write-back for a provider's events. */
export function eventsFunctionFor(provider: CalendarProvider): "google-events" | "icloud-events" {
  return provider === "icloud" ? "icloud-events" : "google-events";
}

/** Badge letter/name/color for a connected account's provider — the only thing
 *  that tells two accounts apart when they share an email (e.g. Google + iCloud
 *  both added under the same address). */
export function providerMeta(p: CalendarProvider): { letter: string; name: string; color: string } {
  return p === "google"
    ? { letter: "G", name: "Google", color: "#4285F4" }
    : p === "m365"
      ? { letter: "M", name: "Microsoft 365", color: "#2563EB" }
      : p === "icloud"
        ? { letter: "", name: "Apple Calendar", color: "#111111" }
        : { letter: "↻", name: "Subscribed calendar", color: "#0EA5E9" };
}

/** Human label for a provider — disambiguates accounts that share an email. */
export function providerLabel(provider: CalendarProvider): string {
  switch (provider) {
    case "google": return "Google";
    case "icloud": return "iCloud";
    case "m365": return "Microsoft";
    case "ics": return "Subscription";
  }
}

/** A calendar we know can't receive a write despite being listed — Google
 *  subscriptions / holiday feeds are read-only mirrors. */
export function isReadOnlyCalendarId(id: string): boolean {
  return (
    id.includes("@import.calendar.google.com") ||
    id.includes("#holiday@") ||
    id.includes("@group.v.calendar.google.com")
  );
}

/** One connected, writable account and the calendars an event can move onto. */
export interface MoveTargetGroup {
  accountId: string;
  accountLabel: string;
  provider: CalendarProvider;
  calendars: CalendarInfo[];
}

/** Every calendar an event can be moved to, grouped by account — the source for
 *  the calendar/account picker. Read-only accounts and read-only calendar feeds
 *  are excluded; `keepCalendarId` is always retained so the event's current
 *  calendar shows even if it looks read-only. */
export function writableCalendarTargets(
  accounts: CalendarAccount[],
  keepCalendarId?: string,
): MoveTargetGroup[] {
  return accounts
    .filter((a) => isWritableAccount(a))
    .map((a) => ({
      accountId: a.id,
      accountLabel: a.email,
      provider: a.provider,
      calendars: (a.calendars ?? []).filter(
        (c) => c.id === keepCalendarId || !isReadOnlyCalendarId(c.id),
      ),
    }))
    .filter((g) => g.calendars.length > 0);
}
