import { describe, expect, it } from "vitest";
import { icloudSeriesOrFilter } from "../supabase/functions/_shared/icloudSeries.ts";
import { isWritableAccount, isWritableCalendar, pickCreateTarget } from "../src/lib/calendarWrite";

describe("icloudSeriesOrFilter", () => {
  it("quotes the uid so colons in uid::* are not PostgREST operators", () => {
    const uid = "7F3D6105-6AC2-4E92-9A6D-220E3345DD92";
    const filter = icloudSeriesOrFilter(uid);
    expect(filter).toBe(
      `provider_event_id.eq."${uid}",provider_event_id.like."${uid}::*"`,
    );
    // The unquoted form (`like.${uid}::*`) is how ALL-scope local rewrites
    // silently matched zero rows — colon is reserved in the filter grammar.
    expect(filter).not.toContain(`like.${uid}::`);
  });
});

describe("isWritableCalendar", () => {
  const google = { provider: "google" as const, sync_direction: "two_way" as const };

  it("lets a two-way Google calendar through and blocks import feeds", () => {
    expect(isWritableAccount(google)).toBe(true);
    expect(isWritableCalendar(google, "primary")).toBe(true);
    expect(
      isWritableCalendar(google, "bnns280p2opltip4bqi15ce25uo757fs@import.calendar.google.com"),
    ).toBe(false);
  });
});

describe("pickCreateTarget", () => {
  const icloud = {
    id: "acct-icloud",
    provider: "icloud" as const,
    email: "phillipchan1@gmail.com",
    sync_direction: "two_way" as const,
    mirror_calendar_id: null,
    needs_reconnect: false,
    calendars: [
      { id: "https://caldav/work/", summary: "Work", color: null, visible: true },
      { id: "https://caldav/family/", summary: "Family", color: null, visible: true },
    ],
  };

  it("never lands an unnamed create on a hidden calendar", () => {
    const target = pickCreateTarget([icloud], {
      hiddenIds: ["https://caldav/work/"],
    });
    expect(target?.calendarId).toBe("https://caldav/family/");
  });

  it("returns null when every calendar on the account is hidden", () => {
    expect(
      pickCreateTarget([icloud], {
        hiddenIds: ["https://caldav/work/", "https://caldav/family/"],
        accountId: icloud.id,
      }),
    ).toBeNull();
  });
});
