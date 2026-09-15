import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addDays } from "date-fns";
import { allowAnytimeLanding, localMidnight, spanFromCalendarDrop } from "../src/lib/dates";

const PANE = readFileSync(resolve(__dirname, "../src/components/CalendarPane.tsx"), "utf8");
const CSS = readFileSync(resolve(__dirname, "../src/index.css"), "utf8");

describe("allowAnytimeLanding", () => {
  it("lets an all-day event move to another day", () => {
    expect(allowAnytimeLanding({ nextAllDay: true, wasAllDay: true, kind: "google" })).toBe(true);
    expect(allowAnytimeLanding({ nextAllDay: true, wasAllDay: true, kind: "icloud" })).toBe(true);
  });

  it("lets an all-day event drop onto the timed grid", () => {
    expect(allowAnytimeLanding({ nextAllDay: false, wasAllDay: true, kind: "google" })).toBe(true);
  });

  it("lets a task land on the anytime row", () => {
    expect(allowAnytimeLanding({ nextAllDay: true, wasAllDay: false, kind: "task" })).toBe(true);
  });

  it("refuses a timed event or slot becoming all-day", () => {
    expect(allowAnytimeLanding({ nextAllDay: true, wasAllDay: false, kind: "google" })).toBe(false);
    expect(allowAnytimeLanding({ nextAllDay: true, wasAllDay: false, kind: "icloud" })).toBe(false);
    expect(allowAnytimeLanding({ nextAllDay: true, wasAllDay: false, kind: "slot" })).toBe(false);
    expect(allowAnytimeLanding({ nextAllDay: true, wasAllDay: false, kind: "m365" })).toBe(false);
  });
});

describe("spanFromCalendarDrop", () => {
  it("writes exclusive-end midnights for an all-day span", () => {
    const start = localMidnight(new Date(2026, 8, 15));
    const end = localMidnight(new Date(2026, 8, 18));
    expect(spanFromCalendarDrop(start, end, true)).toEqual({
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    });
  });

  it("defaults a missing all-day end to one day", () => {
    const start = localMidnight(new Date(2026, 8, 15));
    expect(spanFromCalendarDrop(start, null, true)).toEqual({
      start_at: start.toISOString(),
      end_at: addDays(start, 1).toISOString(),
    });
  });

  it("rejects a zero-length all-day span", () => {
    const day = localMidnight(new Date(2026, 8, 15));
    expect(spanFromCalendarDrop(day, day, true)).toBeNull();
  });

  it("passes timed instants through", () => {
    const start = new Date("2026-09-15T16:00:00.000Z");
    const end = new Date("2026-09-15T17:30:00.000Z");
    expect(spanFromCalendarDrop(start, end, false)).toEqual({
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    });
  });
});

describe("Schedule all-day events are first-class on the grid", () => {
  it("does not lock writable all-day events out of drag or resize", () => {
    expect(PANE).not.toMatch(/editable:\s*writable\s*&&\s*!e\.all_day/);
    expect(PANE).not.toMatch(/durationEditable:\s*writable\s*&&\s*!e\.all_day/);
    expect(PANE).toMatch(/editable:\s*writable/);
    expect(PANE).toMatch(/durationEditable:\s*writable/);
    expect(PANE).toMatch(/eventAllow=\{eventAllow\}/);
    expect(PANE).toMatch(/eventResizableFromStart/);
  });

  it("marks left/right grips on daygrid chips, not the time-grid bar", () => {
    expect(CSS).toMatch(/\.fc-daygrid-event \.fc-event-resizer-start/);
    expect(CSS).toMatch(/\.fc-daygrid-event \.fc-event-resizer-end/);
    expect(CSS).toMatch(/cursor:\s*ew-resize/);
    const daygridAfter = CSS.match(
      /\.fc \.fc-daygrid-event \.fc-event-resizer::after\s*\{([^}]+)\}/,
    )?.[1];
    expect(daygridAfter, "daygrid grip must be a vertical pill").toBeTruthy();
    expect(daygridAfter).toMatch(/width:\s*3px/);
    expect(daygridAfter).toMatch(/height:\s*12px/);
  });
});
