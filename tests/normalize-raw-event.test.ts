// M365-synced events store the Microsoft Graph event resource verbatim in
// `external_events.raw` — a different vocabulary from Google's (attendees
// keyed by `emailAddress.address` not `email`, `body.content` not
// `description`, `onlineMeeting.joinUrl` not `hangoutLink`…). Every reader
// (SlideOver, MobileEventSheet, CalendarPane, joinUrl/conferenceName) only
// understands Google's shape, so `normalizeRawEvent` translates Graph into
// it once at the read boundary. This pins that translation so a guest list,
// join link, or description doesn't silently go blank for M365 events.
//
// Run: npm test

import { describe, expect, it } from "vitest";

import { normalizeRawEvent, type GraphRawEvent } from "../src/lib/types";

const GRAPH_EVENT: GraphRawEvent = {
  bodyPreview: "Quick sync on Q3 roadmap",
  attendees: [
    {
      emailAddress: { address: "phil@frontierchurch.us", name: "Phil Chan" },
      status: { response: "accepted" },
      type: "required",
    },
    {
      emailAddress: { address: "guest@example.com", name: "Guest Person" },
      status: { response: "tentativelyAccepted" },
      type: "optional",
    },
  ],
  organizer: { emailAddress: { address: "boss@frontierchurch.us", name: "The Boss" } },
  body: { contentType: "html", content: "<p>Agenda: <b>roadmap</b></p>" },
  webLink: "https://outlook.office.com/calendar/item/abc123",
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
  onlineMeetingProvider: "teamsForBusiness",
  seriesMasterId: "series-42",
};

describe("normalizeRawEvent", () => {
  it("passes a Google-shaped payload through untouched", () => {
    const google = {
      attendees: [{ email: "a@b.com", responseStatus: "accepted" as const, self: true }],
      description: "hi",
      htmlLink: "https://calendar.google.com/x",
    };
    expect(normalizeRawEvent(google, "a@b.com")).toEqual(google);
  });

  it("returns null for a null/undefined payload", () => {
    expect(normalizeRawEvent(null)).toBeNull();
    expect(normalizeRawEvent(undefined)).toBeNull();
  });

  it("maps Graph attendees into Google's shape, marking self and organizer by email", () => {
    const out = normalizeRawEvent(GRAPH_EVENT, "phil@frontierchurch.us");
    expect(out?.attendees).toEqual([
      {
        email: "phil@frontierchurch.us",
        displayName: "Phil Chan",
        responseStatus: "accepted",
        self: true,
        organizer: false,
        optional: false,
      },
      {
        email: "guest@example.com",
        displayName: "Guest Person",
        responseStatus: "tentative",
        self: false,
        organizer: false,
        optional: true,
      },
    ]);
  });

  it("marks the organizer's own attendee row when the account IS the organizer", () => {
    const out = normalizeRawEvent(GRAPH_EVENT, "boss@frontierchurch.us");
    expect(out?.organizer).toEqual({
      email: "boss@frontierchurch.us",
      displayName: "The Boss",
      self: true,
    });
  });

  it("carries description (HTML passes through), webLink, and a joinable Teams link", () => {
    const out = normalizeRawEvent(GRAPH_EVENT, "phil@frontierchurch.us");
    expect(out?.description).toBe("<p>Agenda: <b>roadmap</b></p>");
    expect(out?.htmlLink).toBe("https://outlook.office.com/calendar/item/abc123");
    expect(out?.conferenceData?.entryPoints?.[0]).toEqual({
      entryPointType: "video",
      uri: "https://teams.microsoft.com/l/meetup-join/abc",
    });
    expect(out?.conferenceData?.conferenceSolution?.name).toBe("Microsoft Teams");
    expect(out?.recurringEventId).toBe("series-42");
  });

  it("escapes and line-breaks a plain-text Graph body instead of dropping it", () => {
    const out = normalizeRawEvent(
      { bodyPreview: "line one\nline two <tag>", attendees: [] },
      "phil@frontierchurch.us",
    );
    expect(out?.description).toBe("line one<br>line two &lt;tag&gt;");
  });

  it("omits conferenceData when there's no online meeting", () => {
    const out = normalizeRawEvent({ bodyPreview: "", attendees: [] }, "phil@frontierchurch.us");
    expect(out?.conferenceData).toBeUndefined();
  });
});
