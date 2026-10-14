// Calendar fixtures for the dev verify harnesses (?meet, ?capture) and the
// picker tests — imported only by them, so nothing here reaches a production
// bundle.
//
// Shaped to exercise `EventCalendarPicker`: two accounts (so headings show),
// several calendars under one login (the case the old per-account chips could
// not reach), a read-only feed and a hidden calendar (both must never be
// offered), and a default account that isn't first in the list.

import type { CalendarAccount, UserSettings } from "../../lib/types";

export const HARNESS_CALENDAR_ACCOUNTS: CalendarAccount[] = [
  {
    id: "acct-icloud",
    provider: "icloud",
    email: "you@icloud.com",
    sync_direction: "two_way",
    mirror_calendar_id: null,
    needs_reconnect: false,
    calendars: [
      { id: "https://caldav.example/home/", summary: "Home", color: "#5E9E6E", visible: true },
      { id: "https://caldav.example/family/", summary: "Family", color: "#C27D4A", visible: true },
    ],
  },
  {
    id: "acct-google",
    provider: "google",
    email: "you@example.com",
    sync_direction: "two_way",
    mirror_calendar_id: null,
    needs_reconnect: false,
    calendars: [
      { id: "you@example.com", summary: "You", color: "#5B7FC7", visible: true },
      { id: "work-cal@group.calendar.google.com", summary: "Work", color: "#8E6BB8", visible: true },
      { id: "church-cal@group.calendar.google.com", summary: "Church", color: "#B8864E", visible: true },
      { id: "hidden-cal@group.calendar.google.com", summary: "Hidden — never offered", color: "#999999", visible: true },
      { id: "en.usa#holiday@group.v.calendar.google.com", summary: "Holidays — read-only", color: "#999999", visible: true },
    ],
  },
  {
    id: "acct-ics",
    provider: "ics",
    email: "feed@example.com",
    sync_direction: "read_only",
    mirror_calendar_id: null,
    needs_reconnect: false,
    calendars: [{ id: "feed", summary: "Subscribed — read-only", color: null, visible: true }],
  },
];

// The default is a calendar that is NOT its account's own (Work, not You), so
// the "default" mark and the untouched composer both prove the calendar half of
// the setting is read, not just the account half.
export const HARNESS_SETTINGS = {
  user_id: "harness",
  hidden_calendar_ids: ["hidden-cal@group.calendar.google.com"],
  default_calendar_account_id: "acct-google",
  default_calendar_id: "work-cal@group.calendar.google.com",
} as Partial<UserSettings>;
