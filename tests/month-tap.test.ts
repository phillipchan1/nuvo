import { describe, expect, it } from "vitest";
import { clampDayToMonth, monthDayIntent } from "../src/components/mobile/monthTap";

// The phone's month grid: a day tap selects so the list under it can answer.
// Tapping the already-selected day (or the list header) opens Day. Zooming
// on the first tap made that list unreachable for any date but today (D-121).

describe("monthDayIntent", () => {
  it("selects a day that is not the current selection", () => {
    expect(monthDayIntent(new Date(2026, 7, 27), new Date(2026, 7, 30))).toBe("select");
  });

  it("opens the already-selected day", () => {
    expect(monthDayIntent(new Date(2026, 7, 27, 9), new Date(2026, 7, 27, 18))).toBe("open");
  });

  it("selects the same date-of-month in a different month", () => {
    expect(monthDayIntent(new Date(2026, 7, 27), new Date(2026, 6, 27))).toBe("select");
  });
});

describe("clampDayToMonth", () => {
  it("keeps the date-of-month when the next month has it", () => {
    const next = clampDayToMonth(new Date(2026, 7, 15), new Date(2026, 8, 1));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(15);
  });

  it("clamps 31 to the last day of a shorter month", () => {
    const feb = clampDayToMonth(new Date(2026, 7, 31), new Date(2026, 1, 1));
    expect(feb.getMonth()).toBe(1);
    expect(feb.getDate()).toBe(28);
  });
});
