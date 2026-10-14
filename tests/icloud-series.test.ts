import { describe, expect, it } from "vitest";
import { icloudSeriesOrFilter } from "../supabase/functions/_shared/icloudSeries.ts";
import {
  createTargetGroups,
  isWritableAccount,
  isWritableCalendar,
  pickCreateTarget,
} from "../src/lib/calendarWrite";
import { HARNESS_CALENDAR_ACCOUNTS } from "../src/components/calendar/calendarFixtures";

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

// The composers' picker offers calendars, not accounts. Every one of these is
// a calendar the old per-account chips could never reach.
describe("createTargetGroups + a picked calendar", () => {
  const accounts = HARNESS_CALENDAR_ACCOUNTS;
  const HIDDEN = "hidden-cal@group.calendar.google.com";

  it("offers every visible writable calendar, grouped by account", () => {
    const groups = createTargetGroups(accounts, [HIDDEN]);
    expect(groups.map((g) => g.accountId)).toEqual(["acct-icloud", "acct-google"]);
    const google = groups.find((g) => g.accountId === "acct-google")!;
    // Hidden (D-047) and the read-only holiday feed are not offered; the
    // read-only ICS account isn't a group at all.
    expect(google.calendars.map((c) => c.summary)).toEqual(["You", "Work", "Church"]);
  });

  it("lands on the picked calendar, not the account's own", () => {
    expect(
      pickCreateTarget(accounts, {
        hiddenIds: [HIDDEN],
        defaultAccountId: "acct-google",
        accountId: "acct-google",
        calendarId: "church-cal@group.calendar.google.com",
      }),
    ).toEqual({ accountId: "acct-google", calendarId: "church-cal@group.calendar.google.com" });
  });

  it("untouched, follows the Settings default account's own calendar", () => {
    expect(
      pickCreateTarget(accounts, { hiddenIds: [HIDDEN], defaultAccountId: "acct-google" }),
    ).toEqual({ accountId: "acct-google", calendarId: "you@example.com" });
  });

  it("never honours a pick of a hidden calendar — falls back within the account", () => {
    expect(
      pickCreateTarget(accounts, {
        hiddenIds: [HIDDEN],
        accountId: "acct-google",
        calendarId: HIDDEN,
      }),
    ).toEqual({ accountId: "acct-google", calendarId: "you@example.com" });
  });

  it("a calendar id only counts under the account it was picked from", () => {
    expect(
      pickCreateTarget(accounts, {
        accountId: "acct-icloud",
        calendarId: "work-cal@group.calendar.google.com",
      }),
    ).toEqual({ accountId: "acct-icloud", calendarId: "https://caldav.example/home/" });
  });
});
