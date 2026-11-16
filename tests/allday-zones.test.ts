// @vitest-environment jsdom
/**
 * An all-day day is written ONE way — its civil date at UTC midnight
 * (`allDayInstant`) — so every reader that takes the leading date gets the day
 * the user meant, in every zone.
 *
 * Before: the client sent LOCAL midnight through `toISOString()`. West of
 * Greenwich that kept the date (Los Angeles: `…T08:00:00.000Z`); east of it the
 * date slipped back a day (Paris: Thu Nov 19 left as `2026-11-18T23:00:00.000Z`)
 * — and Google (`googleStartEnd` slices the date), iCloud (`toIcalDate`) and
 * this device's own optimistic row (`allDayDates`) all put it on Wednesday.
 * Inspectors then read ICS / M365 rows (stored at UTC midnight) as instants and
 * opened them on the previous day west of Greenwich.
 *
 * Node honours a runtime `TZ` change; each zone block sets its own.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allDayDates,
  allDayInclusiveEnd,
  allDayRangeFromStart,
  eventStartDay,
  parseDateISO,
  spanFromCalendarDrop,
  toDateISO,
} from "../src/lib/dates";
import { googleStartEnd } from "../supabase/functions/_shared/googleDateTime";
import { buildEvent, toIcalDate } from "../supabase/functions/_shared/icalwrite.ts";
import { allDayTap } from "../src/components/mobile/planRows";
import type { ExternalEvent } from "../src/lib/types";

// East of UTC (where writes slipped), the app's own zone (must not regress),
// and west of UTC−8 (Honolulu, Pago Pago) where local midnight is late in UTC.
const ZONES = [
  "Europe/Paris",
  "Asia/Tokyo",
  "Pacific/Kiritimati",
  "America/Los_Angeles",
  "Pacific/Honolulu",
  "Pacific/Pago_Pago",
  "UTC",
];

const realTZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = realTZ;
});

describe.each(ZONES)("all-day writes in %s", (zone) => {
  beforeAll(() => {
    process.env.TZ = zone;
  });

  it("a chip dropped on Thu Nov 19 is written, read back and sent as Nov 19", () => {
    // FullCalendar hands local-midnight Dates for an all-day drop.
    const span = spanFromCalendarDrop(parseDateISO("2026-11-19"), parseDateISO("2026-11-20"), true)!;
    expect(span).toEqual({ start_at: "2026-11-19T00:00:00.000Z", end_at: "2026-11-20T00:00:00.000Z" });
    // the optimistic row, read back by the grid and the phone
    expect(allDayDates(span.start_at, span.end_at)).toEqual({ start: "2026-11-19", end: "2026-11-20" });
    // what the server sends Google
    const g = googleStartEnd(span.start_at, span.end_at, true);
    expect(g.start.date).toBe("2026-11-19");
    expect(g.end.date).toBe("2026-11-20");
    // what the server writes to iCloud
    expect(toIcalDate(span.start_at)).toBe("20261119");
    expect(toIcalDate(span.end_at)).toBe("20261120");
    const ics = buildEvent({ uid: "u", title: "Offsite", startISO: span.start_at, endISO: span.end_at, allDay: true });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261119");
    expect(ics).toContain("DTEND;VALUE=DATE:20261120");
  });

  it("the inspectors' and composer's range keeps its days (multi-day, across DST)", () => {
    // Mar 7–9 2026 spans the US spring-forward; Mar 28–30 the EU one.
    for (const [first, last, exclusive] of [
      ["2026-03-07", "2026-03-09", "2026-03-10"],
      ["2026-03-28", "2026-03-30", "2026-03-31"],
      ["2026-11-19", "2026-11-19", "2026-11-20"],
    ]) {
      const r = allDayRangeFromStart(parseDateISO(first), parseDateISO(last));
      expect(allDayDates(r.start_at, r.end_at)).toEqual({ start: first, end: exclusive });
      expect(googleStartEnd(r.start_at, r.end_at, true).start.date).toBe(first);
      expect(toIcalDate(r.start_at)).toBe(first.replace(/-/g, ""));
      expect(toDateISO(allDayInclusiveEnd(r.end_at))).toBe(last);
      expect(eventStartDay(r.start_at, true)).toBe(first);
    }
  });

  it("reads every provider's stored all-day row as its day", () => {
    const rows = {
      ics: { start_at: "2026-09-24T00:00:00+00:00", end_at: "2026-09-26T00:00:00+00:00" },
      google: { start_at: "2026-09-24T08:00:00+00:00", end_at: "2026-09-26T08:00:00+00:00" },
    };
    for (const row of Object.values(rows)) {
      expect(eventStartDay(row.start_at, true)).toBe("2026-09-24");
      expect(toDateISO(allDayInclusiveEnd(row.end_at))).toBe("2026-09-25");
      const tap = allDayTap({
        id: "e", title: "Away", all_day: true, busy: false, calendar_id: "c", account_id: "a",
        provider_event_id: "p", location: null, self_rsvp: null, ...row,
      } as ExternalEvent);
      // the phone's sheet opens on the event's own day
      expect(toDateISO(tap.start)).toBe("2026-09-24");
      expect(toDateISO(tap.end)).toBe("2026-09-26");
    }
  });
});

describe("the desktop inspector reads an all-day row's stored date", () => {
  it("seeds its masthead and date control from eventStartDay, not the instant", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/SlideOver.tsx", "utf8");
    const from = src.indexOf("const startDay = parseDateISO(eventStartDay");
    const inspector = src.slice(from, src.indexOf("const applyRepeat", from));
    expect(from).toBeGreaterThan(0);
    expect(inspector).not.toMatch(/format\(new Date\(startAt\)/);
    expect(inspector).toMatch(/const toDateInput = \(iso: string\) => eventStartDay\(iso, allDay\)/);
  });
});
