import { describe, expect, it } from "vitest";
import { patchMaster, setPartstat, shiftMaster } from "../supabase/functions/_shared/icalwrite.ts";

const WEEKLY = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:standup",
  "DTSTART:20260804T160000Z",
  "DTEND:20260804T163000Z",
  "RRULE:FREQ=WEEKLY",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("shiftMaster", () => {
  it("moves DTSTART and DTEND by the same delta on a drag", () => {
    const next = shiftMaster(WEEKLY, 60 * 60 * 1000);
    expect(next).toContain("DTSTART:20260804T170000Z");
    expect(next).toContain("DTEND:20260804T173000Z");
  });

  it("can lengthen DTEND independently on a resize", () => {
    const next = shiftMaster(WEEKLY, 0, undefined, 15 * 60 * 1000);
    expect(next).toContain("DTSTART:20260804T160000Z");
    expect(next).toContain("DTEND:20260804T164500Z");
  });
});

describe("patchMaster all-day conversion", () => {
  it("converts a timed master to VALUE=DATE without moving the series start", () => {
    const next = patchMaster(WEEKLY, { allDay: true });
    expect(next).toContain("DTSTART;VALUE=DATE:20260804");
    expect(next).toContain("DTEND;VALUE=DATE:20260805");
    expect(next).toContain("RRULE:FREQ=WEEKLY");
    expect(next).not.toContain("DTSTART:20260804T160000Z");
  });

  it("retitles and relocates the master without shifting DTSTART", () => {
    const next = patchMaster(WEEKLY, { title: "Planning", location: "Room A" });
    expect(next).toContain("SUMMARY:Planning");
    expect(next).toContain("LOCATION:Room A");
    expect(next).toContain("DTSTART:20260804T160000Z");
    expect(next).toContain("RRULE:FREQ=WEEKLY");
  });
});

const INVITE = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:standup",
  "DTSTART:20260804T160000Z",
  "DTEND:20260804T163000Z",
  "RRULE:FREQ=WEEKLY",
  "SUMMARY:Standup",
  "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:phil@example.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("setPartstat series vs occurrence", () => {
  it("answers every VEVENT when no occurrence is given", () => {
    const next = setPartstat(INVITE, "phil@example.com", "ACCEPTED");
    expect(next).toContain("PARTSTAT=ACCEPTED");
    expect(next).not.toContain("RECURRENCE-ID");
    expect(next).toContain("RRULE:FREQ=WEEKLY");
  });

  it("THIS clones an override and leaves the master unanswered", () => {
    const next = setPartstat(INVITE, "phil@example.com", "ACCEPTED", "2026-08-11T16:00:00.000Z");
    const master = (next.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []).find(
      (ve) => !/\bRECURRENCE-ID\b/i.test(ve),
    );
    const override = (next.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []).find((ve) =>
      /\bRECURRENCE-ID\b/i.test(ve),
    );
    expect(master).toContain("PARTSTAT=NEEDS-ACTION");
    expect(override).toContain("PARTSTAT=ACCEPTED");
    expect(override).toContain("RECURRENCE-ID:20260811T160000Z");
    expect(master).toContain("RRULE:FREQ=WEEKLY");
  });
});
