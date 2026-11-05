/**
 * The meaning of each event act, said once for both shells (D-176). The desktop
 * menu and popover and the phone's event sheet all import these.
 */
import { describe, expect, it } from "vitest";
import { cancelNotifiesGuests, duplicateEventInput, taskFromEvent } from "../src/lib/eventActs";

describe("taskFromEvent", () => {
  it("takes the event's hour and length", () => {
    const t = taskFromEvent({ title: "Prep", start_at: "2026-11-05T17:00:00.000Z", end_at: "2026-11-05T17:45:00.000Z" });
    expect(t).toMatchObject({ title: "Prep", start_time: "2026-11-05T17:00:00.000Z", duration_minutes: 45 });
  });
  it("never makes a zero-length task", () => {
    const t = taskFromEvent({ title: "x", start_at: "2026-11-05T17:00:00.000Z", end_at: "2026-11-05T17:00:00.000Z" });
    expect(t.duration_minutes).toBe(30);
  });
});

describe("duplicateEventInput", () => {
  it("copies onto the same calendar and never mails anyone", () => {
    const d = duplicateEventInput({
      title: "Sync", start_at: "a", end_at: "b", all_day: false, location: null, account_id: "acc", calendar_id: "cal",
    });
    expect(d).toMatchObject({ title: "Sync (copy)", accountId: "acc", calendarId: "cal", notifyGuests: false });
    expect(d).not.toHaveProperty("attendees");
    expect(d).not.toHaveProperty("recurrence");
  });
});

describe("cancelNotifiesGuests", () => {
  it("counts the other guests only when you organize", () => {
    const attendees = [{ self: true }, {}, {}];
    expect(cancelNotifiesGuests({ organizer: { self: true }, attendees })).toBe(2);
    expect(cancelNotifiesGuests({ organizer: { self: false }, attendees })).toBe(0);
    expect(cancelNotifiesGuests(null)).toBe(0);
  });
});
