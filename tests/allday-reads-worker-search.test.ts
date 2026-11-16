/**
 * Two more readers of an all-day row that read it as an instant:
 *
 *  - the Worker's iCalendar writer (`worker/src/lib/icalwrite.ts`) wrote the
 *    DATE through the runtime's local clock — the same bug the edge function's
 *    copy had; both now write the date the string states;
 *  - calendar search said, and landed on, the previous day for an all-day hit
 *    west of Greenwich (UTC midnight read as local time).
 *
 * The suite runs in America/Los_Angeles (vitest.config.ts), so an instant read
 * of "2026-08-12T00:00:00Z" is the 11th — exactly the failure.
 */
import { describe, expect, it } from "vitest";
import { toIcalDate as workerToIcalDate, buildEvent } from "../worker/src/lib/icalwrite";
import { toIcalDate as edgeToIcalDate } from "../supabase/functions/_shared/icalwrite.ts";
import { eventHitDateISO, eventHitSubtitle, type EventHit } from "../src/lib/eventSearch";

describe("the Worker's iCalendar DATE", () => {
  it("is the date the all-day string states, in every zone", () => {
    expect(workerToIcalDate("2026-08-12T00:00:00.000Z")).toBe("20260812");
    expect(workerToIcalDate("2026-08-12")).toBe("20260812");
  });

  it("agrees with the edge function's writer", () => {
    for (const iso of ["2026-01-01T00:00:00.000Z", "2026-11-19T00:00:00Z", "2026-03-08"]) {
      expect(workerToIcalDate(iso)).toBe(edgeToIcalDate(iso));
    }
  });

  it("writes an all-day event on its own day", () => {
    const ics = buildEvent({
      uid: "u1",
      title: "Offsite",
      startISO: "2026-08-12T00:00:00.000Z",
      endISO: "2026-08-13T00:00:00.000Z",
      allDay: true,
    } as Parameters<typeof buildEvent>[0]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260812");
    expect(ics).toContain("DTEND;VALUE=DATE:20260813");
  });
});

describe("an all-day search hit", () => {
  const hit: EventHit = {
    id: "row-1",
    title: "Offsite",
    start_at: "2026-08-12T00:00:00.000Z",
    end_at: "2026-08-13T00:00:00.000Z",
    all_day: true,
    location: null,
    account_id: "acct",
    provider_event_id: "evt",
    when: "past",
  };

  it("lands on its stored day", () => {
    expect(eventHitDateISO(hit)).toBe("2026-08-12");
  });

  it("says its stored day", () => {
    expect(eventHitSubtitle(hit)).toMatch(/Aug 12/);
    expect(eventHitSubtitle(hit)).toMatch(/all day/);
  });
});
