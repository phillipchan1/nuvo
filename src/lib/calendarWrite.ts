import type { CalendarAccount, CalendarProvider } from "./types";

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
