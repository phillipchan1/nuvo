// The "does this meeting count as time I spent?" rule. Two real bugs live here:
// meetings that never reached the ledger at all (the paged-query fix in
// useExternalEvents), and meetings counted twice because a work calendar is
// mirrored into a second account under a hidden calendar id.

import { describe, expect, it } from "vitest";
import {
  eventCountsAsActual,
  isEventHidden,
  isExternalEventRecurring,
  isGoogleRecurringInstanceId,
  isGoogleSeriesMasterRaw,
  resolveRecurringEventId,
  type ActualsFilter,
} from "../src/lib/eventActuals";
import type { ExternalEvent } from "../src/lib/types";

const NOW = new Date("2026-08-06T20:00:00.000Z");

function ev(partial: Partial<ExternalEvent> = {}): ExternalEvent {
  return {
    id: "row-1",
    account_id: "acct-work",
    provider_event_id: "evt-1",
    calendar_id: "primary",
    title: "POD 4 Sprint Planning",
    start_at: "2026-08-06T17:00:00.000Z",
    end_at: "2026-08-06T18:00:00.000Z",
    all_day: false,
    location: null,
    busy: true,
    self_rsvp: "accepted",
    recurring_event_id: null,
    ...partial,
  } as ExternalEvent;
}

describe("eventCountsAsActual", () => {
  it("counts a past, busy, accepted meeting", () => {
    expect(eventCountsAsActual(ev(), NOW)).toBe(true);
  });

  it("drops all-day, free, future, declined and never-answered events", () => {
    expect(eventCountsAsActual(ev({ all_day: true }), NOW)).toBe(false);
    expect(eventCountsAsActual(ev({ busy: false }), NOW)).toBe(false);
    expect(eventCountsAsActual(ev({ end_at: "2026-08-07T18:00:00.000Z" }), NOW)).toBe(false);
    expect(eventCountsAsActual(ev({ self_rsvp: "declined" }), NOW)).toBe(false);
    expect(eventCountsAsActual(ev({ self_rsvp: "needsAction" }), NOW)).toBe(false);
  });

  it("counts your own block (no invite, so no rsvp)", () => {
    expect(eventCountsAsActual(ev({ self_rsvp: null }), NOW)).toBe(true);
  });

  describe("hidden = out of the ledger", () => {
    it("drops an event on a hidden calendar — the mirrored copy of a mapped one", () => {
      const filter: ActualsFilter = { hiddenCalendarIds: new Set(["work-mirror@import.calendar.google.com"]) };
      const mirrored = ev({ account_id: "acct-personal", calendar_id: "work-mirror@import.calendar.google.com" });
      expect(eventCountsAsActual(mirrored, NOW, filter)).toBe(false);
      // …while the mapped original still counts, so the hour lands exactly once
      expect(eventCountsAsActual(ev(), NOW, filter)).toBe(true);
    });

    it("drops an individually hidden event, and every instance of a hidden series", () => {
      const instance: ActualsFilter = { hiddenEventKeys: new Set(["acct-work:evt-1"]) };
      expect(eventCountsAsActual(ev(), NOW, instance)).toBe(false);

      const series: ActualsFilter = { hiddenEventKeys: new Set(["acct-work:series:master-9"]) };
      expect(eventCountsAsActual(ev({ provider_event_id: "evt-2", recurring_event_id: "master-9" }), NOW, series)).toBe(false);
      expect(eventCountsAsActual(ev({ provider_event_id: "evt-3", recurring_event_id: "other" }), NOW, series)).toBe(true);
    });

    it("is a no-op with no filter — the ledger's default is still every attended meeting", () => {
      expect(eventCountsAsActual(ev(), NOW, {})).toBe(true);
      expect(eventCountsAsActual(ev(), NOW, { hiddenCalendarIds: new Set(), hiddenEventKeys: new Set() })).toBe(true);
    });
  });
});

describe("isEventHidden", () => {
  it("matches instance keys and series keys, and short-circuits on an empty set", () => {
    const e = { account_id: "a", provider_event_id: "p", recurring_event_id: "m" };
    expect(isEventHidden(e, new Set())).toBe(false);
    expect(isEventHidden(e, new Set(["a:p"]))).toBe(true);
    expect(isEventHidden(e, new Set(["a:series:m"]))).toBe(true);
    expect(isEventHidden({ ...e, recurring_event_id: null }, new Set(["a:series:m"]))).toBe(false);
  });
});

describe("isExternalEventRecurring", () => {
  it("detects DB recurring_event_id, Google instances, series masters, and iCloud occurrences", () => {
    expect(isExternalEventRecurring({ recurring_event_id: "master", provider_event_id: "x" })).toBe(true);
    expect(
      isExternalEventRecurring(
        { recurring_event_id: null, provider_event_id: "abc_20260820T160000Z" },
        { provider: "google" },
      ),
    ).toBe(true);
    expect(
      isExternalEventRecurring(
        { recurring_event_id: null, provider_event_id: "master-id" },
        { raw: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] }, provider: "google" },
      ),
    ).toBe(true);
    expect(
      isExternalEventRecurring(
        { recurring_event_id: null, provider_event_id: "uid::recur-1" },
        { provider: "icloud" },
      ),
    ).toBe(true);
    expect(
      isExternalEventRecurring(
        { recurring_event_id: null, provider_event_id: "one-off" },
        { provider: "google" },
      ),
    ).toBe(false);
  });
});

describe("resolveRecurringEventId", () => {
  it("prefers the DB column, then raw, then parses a Google instance id", () => {
    expect(resolveRecurringEventId({ recurring_event_id: "m", provider_event_id: "p" })).toBe("m");
    expect(
      resolveRecurringEventId(
        { recurring_event_id: null, provider_event_id: "p" },
        { raw: { recurringEventId: "from-raw" }, provider: "google" },
      ),
    ).toBe("from-raw");
    expect(
      resolveRecurringEventId(
        { recurring_event_id: null, provider_event_id: "abc_20260820T160000Z" },
        { provider: "google" },
      ),
    ).toBe("abc");
  });
});

describe("isGoogleRecurringInstanceId", () => {
  it("matches Google's instance suffix", () => {
    expect(isGoogleRecurringInstanceId("abc_20260820T160000Z")).toBe(true);
    expect(isGoogleRecurringInstanceId("abc_20260820T160000")).toBe(true);
    expect(isGoogleRecurringInstanceId("abc")).toBe(false);
  });
});

describe("isGoogleSeriesMasterRaw", () => {
  it("is true only when recurrence is present without recurringEventId", () => {
    expect(isGoogleSeriesMasterRaw({ recurrence: ["RRULE:FREQ=WEEKLY"], recurringEventId: undefined })).toBe(true);
    expect(isGoogleSeriesMasterRaw({ recurrence: ["RRULE:FREQ=WEEKLY"], recurringEventId: "m" })).toBe(false);
    expect(isGoogleSeriesMasterRaw(null)).toBe(false);
  });
});
