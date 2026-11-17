import { describe, expect, it } from "vitest";
import { calendarSyncFailure } from "../src/lib/calendarSync";

// D-244: a calendar Google still lists but Nuvo can't read says so in Settings.
const NOW = Date.parse("2026-11-17T18:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;

describe("calendarSyncFailure", () => {
  it("is silent while the calendar syncs", () => {
    expect(calendarSyncFailure({ sync_error: null, last_synced_at: ago(H) }, NOW)).toBeNull();
    expect(calendarSyncFailure({}, NOW)).toBeNull();
  });

  it("counts from the last good sync, not the last failed attempt", () => {
    const f = calendarSyncFailure({ sync_error: "events list x: 500", last_synced_at: ago(3 * 24 * H) }, NOW);
    expect(f).toEqual({ label: "Not syncing for 3 days", detail: "events list x: 500" });
  });

  it("speaks in minutes, hours, days, then a date", () => {
    const at = (ms: number) => calendarSyncFailure({ sync_error: "e", last_synced_at: ago(ms) }, NOW)?.label;
    expect(at(20_000)).toBe("Not syncing for 1 min");
    expect(at(25 * 60_000)).toBe("Not syncing for 25 min");
    expect(at(H)).toBe("Not syncing for 1 hour");
    expect(at(5 * H)).toBe("Not syncing for 5 hours");
    expect(at(24 * H)).toBe("Not syncing for 1 day");
    expect(at(92 * 24 * H)).toMatch(/^Not syncing since \S+ \d+$/);
  });

  it("says only 'Not syncing' when the calendar never synced", () => {
    expect(calendarSyncFailure({ sync_error: "e", last_synced_at: null }, NOW)?.label).toBe("Not syncing");
  });
});
