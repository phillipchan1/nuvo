import type { CalendarInfo } from "./types";

/**
 * Whether one calendar is syncing, said once for every surface that shows it (D-244).
 *
 * Since D-243 a Google calendar syncs or fails on its own, and a failure is
 * written on that calendar (`sync_error` / `sync_error_at` in
 * `calendar_accounts.calendars`). The Worker clears both on the next good sync
 * and drops a calendar Google no longer lists. So a `sync_error` here means a
 * calendar that's still listed but whose events Nuvo can't read, and its
 * events in Nuvo are as old as its last good sync.
 *
 * "For how long" is measured from the last good sync (`last_synced_at`), not
 * from `sync_error_at`: the Worker rewrites that stamp on every failed attempt,
 * so it would always read "a few minutes".
 */
export interface CalendarSyncFailure {
  /** "Not syncing for 3 days", or just "Not syncing" when Nuvo never synced it. */
  label: string;
  /** The Worker's own message, for a tooltip only. Never the visible words. */
  detail: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function calendarSyncFailure(
  c: Pick<CalendarInfo, "sync_error" | "last_synced_at">,
  now: number = Date.now(),
): CalendarSyncFailure | null {
  if (!c.sync_error) return null;
  const last = c.last_synced_at ? Date.parse(c.last_synced_at) : NaN;
  return { label: Number.isFinite(last) ? `Not syncing ${forHowLong(now - last, last)}` : "Not syncing", detail: c.sync_error };
}

function forHowLong(ms: number, since: number): string {
  if (ms < HOUR) {
    const m = Math.max(1, Math.round(ms / MIN));
    return `for ${m} min`;
  }
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return `for ${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(ms / DAY);
  if (d <= 60) return `for ${d} day${d === 1 ? "" : "s"}`;
  return `since ${new Date(since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
