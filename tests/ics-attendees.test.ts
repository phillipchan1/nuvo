// A subscribed ICS/CalDAV feed (Exchange, iCloud) carries attendees, an
// organizer, and a description on the wire just like Google/Graph do — but
// `parseIcs` used to throw all of it away and write `raw: null`. Phil's real
// setup is exactly this: company policy blocks M365 OAuth, so his work
// calendar is a *subscribed ICS feed*, and that's the path that actually
// needed the fix, not M365's OAuth sync (see [[nuvo-m365-google-shape-gap]]).
//
// This pins the extraction: attendees/organizer/description now land in
// `raw` using the same field names `normalizeRawEvent` (src/lib/types.ts)
// and every UI reader already expect from a Google event, so nothing else
// has to change to display them.
//
// Run: npm test

import { describe, expect, it } from "vitest";

import { parseIcs } from "../supabase/functions/_shared/ics.ts";

const ICS_WITH_ATTENDEES = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@example.com
DTSTAMP:20260812T000000Z
DTSTART:20260813T160000Z
DTEND:20260813T170000Z
SUMMARY:OE Huddle
LOCATION:Microsoft Teams Meeting
DESCRIPTION:Agenda:\\nDiscuss Q3 roadmap\\nJoin: https://teams.microsoft.com/l/meetup-join/abc
ORGANIZER;CN=Boss Person:mailto:boss@sce.org
ATTENDEE;CN=Phil Chan;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:phil@frontierchurch.us
ATTENDEE;CN=Guest Person;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:mailto:guest@example.com
END:VEVENT
END:VCALENDAR
`;

const BASE_OPTS = {
  userId: "user-1",
  accountId: "acct-1",
  windowStart: new Date("2026-08-01T00:00:00Z"),
  windowEnd: new Date("2026-08-31T00:00:00Z"),
  runStamp: "2026-08-12T00:00:00Z",
};

describe("parseIcs — attendees/organizer/description", () => {
  it("extracts attendees, organizer, and an HTML-safe description into raw", () => {
    const { rows } = parseIcs(ICS_WITH_ATTENDEES, { ...BASE_OPTS, ownerEmail: "phil@frontierchurch.us" });
    expect(rows).toHaveLength(1);
    const raw = rows[0].raw as Record<string, unknown>;

    expect(raw.organizer).toEqual({ email: "boss@sce.org", displayName: "Boss Person", self: false });
    expect(raw.attendees).toEqual([
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
    expect(raw.description).toBe(
      "Agenda:<br>Discuss Q3 roadmap<br>Join: https://teams.microsoft.com/l/meetup-join/abc",
    );
    // Location was already captured before this fix — still there.
    expect(rows[0].location).toBe("Microsoft Teams Meeting");
  });

  it("marks the organizer's own row self when the account IS the organizer", () => {
    const { rows } = parseIcs(ICS_WITH_ATTENDEES, { ...BASE_OPTS, ownerEmail: "boss@sce.org" });
    const raw = rows[0].raw as Record<string, unknown>;
    expect(raw.organizer).toMatchObject({ self: true });
  });

  it("returns raw: null for an event with no attendees/organizer/description", () => {
    const bare = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-2@example.com
DTSTAMP:20260812T000000Z
DTSTART:20260814T160000Z
DTEND:20260814T170000Z
SUMMARY:Just a block
END:VEVENT
END:VCALENDAR
`;
    const { rows } = parseIcs(bare, BASE_OPTS);
    expect(rows[0].raw).toBeNull();
  });

  it("omits self when no ownerEmail is passed (e.g. no account context)", () => {
    const { rows } = parseIcs(ICS_WITH_ATTENDEES, BASE_OPTS);
    const raw = rows[0].raw as Record<string, unknown>;
    expect((raw.organizer as { self?: boolean }).self).toBeUndefined();
  });
});
