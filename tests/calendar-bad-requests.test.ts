// Requests the server can only refuse with a 400 are not offered (2026-11-15 audit).
import { describe, expect, it } from "vitest";
import { writableCalendarTargets } from "../src/lib/calendarWrite";
import { duplicateEventInput } from "../src/lib/eventActs";
import { isAttendee, setPartstat } from "../worker/src/lib/icalwrite.ts";
import type { CalendarAccount, ExternalEvent } from "../src/lib/types";

const cal = (id: string) => ({ id, summary: id, color: null, visible: true });
const icloud: CalendarAccount = {
  id: "acct-1",
  provider: "icloud",
  email: "me@icloud.com",
  sync_direction: "two_way",
  calendars: [cal("home"), cal("work"), cal("family")],
  mirror_calendar_id: null,
  needs_reconnect: false,
};

describe("move targets leave out hidden calendars", () => {
  it("drops a hidden calendar — iCloud answers a move into one with 400", () => {
    const ids = writableCalendarTargets([icloud], "home", ["family"])[0].calendars.map((c) => c.id);
    expect(ids).toEqual(["home", "work"]);
  });
  it("keeps the event's own calendar even when it is hidden", () => {
    const ids = writableCalendarTargets([icloud], "family", ["family"])[0].calendars.map((c) => c.id);
    expect(ids).toContain("family");
  });
});

describe("duplicate never sends an empty account id", () => {
  it("an unconfirmed row's blank ids fall back to the default calendar", () => {
    const input = duplicateEventInput({
      title: "Lunch",
      start_at: "2026-11-16T12:00:00Z",
      end_at: "2026-11-16T13:00:00Z",
      all_day: false,
      location: null,
      account_id: "",
      calendar_id: "",
    } as unknown as ExternalEvent);
    expect(input.accountId).toBeUndefined();
    expect(input.calendarId).toBeUndefined();
  });
});

describe("iCloud RSVP: listed is about the address, not about the text changing", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:abc",
    "ORGANIZER:mailto:boss@example.com",
    "ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:Me@iCloud.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("an answer you already gave still finds you on the guest list", () => {
    // The old check: same answer → unchanged text → "not listed" 400.
    expect(setPartstat(ics, "me@icloud.com", "ACCEPTED")).toBe(ics);
    expect(isAttendee(ics, "me@icloud.com")).toBe(true);
  });
  it("someone not on the list is still refused", () => {
    expect(isAttendee(ics, "stranger@example.com")).toBe(false);
    expect(isAttendee(ics, "boss@example.com")).toBe(false);
  });
});
