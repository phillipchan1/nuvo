import type { CalendarAccount, CalendarInfo, CalendarProvider } from "./types";

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
