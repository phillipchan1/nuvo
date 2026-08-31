import { describe, expect, it } from "vitest";
import { shiftMaster } from "../supabase/functions/_shared/icalwrite.ts";

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
