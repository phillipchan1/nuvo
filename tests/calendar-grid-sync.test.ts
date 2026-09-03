import { describe, expect, it } from "vitest";
import { gridSyncPlan } from "../src/lib/calendarGridSync";
import type { CalendarBlockInput } from "../src/lib/syncCalendarEvents";

const sample: CalendarBlockInput[] = [
  { id: "task:1", title: "One", start: "2026-09-01T15:00:00.000Z" },
];

describe("gridSyncPlan", () => {
  it("runs sync when no gesture is live", () => {
    expect(gridSyncPlan(false, sample)).toEqual({ run: true, stash: null });
  });

  it("defers sync and stashes the next snapshot while a drag is live", () => {
    expect(gridSyncPlan(true, sample)).toEqual({ run: false, stash: sample });
  });
});
