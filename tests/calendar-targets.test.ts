// Where an agent-created event is allowed to land.
//
// The bug this pins: asked to add "Call with Tiffany Souers", the agent put it
// on a **Women's** calendar the user had hidden from their board months before.
// Two silent gaps made that a legal answer — the write-target list didn't
// filter hidden calendars the way the events feed did, and the fallback was
// "first Google row wins" rather than the account the user actually marked
// default. Neither would fail a typecheck, and both look fine in an account
// where the first row happens to be benign (Principle 16).
//
// So the rule is pinned here instead: hidden means never offered, still
// nameable, and unnamed always means the default.
//
// Run: npm test

import { describe, expect, it } from "vitest";

import {
  buildWritableCalendars,
  offerableCalendars,
  pickDefaultCalendar,
  type RawCalendarAccount,
} from "../supabase/functions/agent/calendars.ts";

/** Phil's real shape: a work Google account whose first calendar is a topical
 *  one, a personal Google account that IS the default, and an iCloud account. */
const ACCOUNTS: RawCalendarAccount[] = [
  {
    id: "acct-frontier",
    provider: "google",
    email: "phil@frontierchurch.com",
    sync_direction: "two_way",
    calendars: [
      { id: "womens@group.calendar.google.com", summary: "Women's" },
      { id: "phil@frontierchurch.com", summary: "phil@frontierchurch.com" },
      { id: "en.usa#holiday@group.v.calendar.google.com", summary: "Holidays" },
    ],
  },
  {
    id: "acct-personal",
    provider: "google",
    email: "phillipchan1@gmail.com",
    sync_direction: "two_way",
    calendars: [{ id: "phillipchan1@gmail.com", summary: "phillipchan1@gmail.com" }],
  },
  {
    id: "acct-icloud",
    provider: "icloud",
    email: "phillipchan1@gmail.com",
    sync_direction: "two_way",
    calendars: [{ id: "cal-family", summary: "Family" }],
  },
  {
    id: "acct-sub",
    provider: "ics",
    email: "bible-plan",
    sync_direction: "read_only",
    calendars: [{ id: "cal-bible", summary: "Bible Reading Plan" }],
  },
];

const HIDDEN = ["womens@group.calendar.google.com"];
const DEFAULT_ACCOUNT = "acct-personal";

const build = (hidden = HIDDEN, def: string | null = DEFAULT_ACCOUNT) =>
  buildWritableCalendars(ACCOUNTS, hidden, def);

describe("writable calendar targets", () => {
  it("keeps read-only accounts and feeds out of the write list entirely", () => {
    const names = build().map((c) => c.name);
    expect(names).not.toContain("Bible Reading Plan"); // read-only account
    expect(names).not.toContain("Holidays"); // read-only calendar id
  });

  it("carries a hidden calendar, flagged — present to be named, not to be picked", () => {
    const womens = build().find((c) => c.name === "Women's");
    expect(womens).toBeDefined();
    expect(womens!.hidden).toBe(true);
  });

  it("marks the default account's PRIMARY calendar, not its first row", () => {
    const marked = build().filter((c) => c.isDefault);
    expect(marked).toHaveLength(1);
    expect(marked[0].calendarId).toBe("phillipchan1@gmail.com");
  });
});

describe("offerableCalendars — what the model is shown", () => {
  it("omits hidden calendars, so the model cannot pick one", () => {
    const offered = offerableCalendars(build()).map((c) => c.name);
    expect(offered).not.toContain("Women's");
    expect(offered).toEqual(
      expect.arrayContaining(["phil@frontierchurch.com", "phillipchan1@gmail.com", "Family"]),
    );
  });

  it("marks exactly one default", () => {
    expect(offerableCalendars(build()).filter((c) => c.isDefault)).toHaveLength(1);
  });
});

describe("pickDefaultCalendar — where an unnamed event goes", () => {
  it("is the user's default account, not the first Google row", () => {
    // The regression itself: "Women's" is the first writable Google calendar in
    // row order, and it must never be the answer to an unnamed create.
    const target = pickDefaultCalendar(build());
    expect(target?.calendarId).toBe("phillipchan1@gmail.com");
  });

  it("never lands on a hidden calendar, even with no default set", () => {
    const target = pickDefaultCalendar(build(HIDDEN, null));
    expect(target?.hidden).toBe(false);
    expect(target?.name).not.toBe("Women's");
  });

  it("ignores a default that points at a hidden calendar", () => {
    // The user hid the very calendar their default account resolves to. Falling
    // back is right; writing somewhere they've taken off the board is not.
    const cals = build(["phillipchan1@gmail.com", ...HIDDEN]);
    const target = pickDefaultCalendar(cals);
    expect(target?.hidden).toBe(false);
    expect(target?.calendarId).not.toBe("phillipchan1@gmail.com");
  });

  it("returns null when every writable calendar is hidden — ask, don't guess", () => {
    const allHidden = ACCOUNTS.flatMap((a) => (a.calendars ?? []).map((c) => c.id));
    expect(pickDefaultCalendar(build(allHidden, DEFAULT_ACCOUNT))).toBeNull();
  });

  it("returns null when nothing writable is connected", () => {
    expect(pickDefaultCalendar(buildWritableCalendars([], [], null))).toBeNull();
  });
});
