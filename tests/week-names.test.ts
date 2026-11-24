import { describe, expect, it } from "vitest";
import { quarterDestination, weekDestination, weekName, weekTick } from "../src/lib/week";

// A Monday-start person on a Sunday: the deck's board says the current week is
// Mon Nov 9 – Sun Nov 15, so its column must be named "This week" / "Now". The
// Sunday-week snap alone called it "Last week" / "−1" and the next one "Now",
// while the deck lit Nov 9 as now (mobile audit, 2026-11-15).
const sunday = new Date(2026, 10, 15, 21, 0); // Sun Nov 15 2026, 9pm
const thisMonday = new Date(2026, 10, 9);
const nextMonday = new Date(2026, 10, 16);

describe("week names follow a board's own week start", () => {
  it("names a Monday-start current week as now on its Sunday", () => {
    expect(weekName(thisMonday, { ref: sunday, asWeekStart: true })).toBe("This week");
    expect(weekTick(thisMonday, { ref: sunday, asWeekStart: true })).toBe("Now");
    expect(weekName(nextMonday, { ref: sunday, asWeekStart: true })).toBe("Next week");
    expect(weekTick(nextMonday, { ref: sunday, asWeekStart: true })).toBe("Next");
  });

  it("keeps Sunday-start boards as they were", () => {
    const thisSunday = new Date(2026, 10, 15);
    expect(weekName(thisSunday, { ref: sunday, asWeekStart: true })).toBe("This week");
    expect(weekTick(new Date(2026, 10, 8), { ref: sunday, asWeekStart: true })).toBe("−1");
  });

  it("leaves callers that don't opt in on the Sunday-week snap", () => {
    expect(weekName(nextMonday, { ref: sunday })).toBe("This week");
  });
});

// Projects are thought of in weeks and bets in quarters, so a move says how far
// in those words — never a date (D-256) — and reads after "Move to".
describe("where a move goes, in words", () => {
  it("counts weeks out, never a date", () => {
    expect(weekDestination(nextMonday, { ref: sunday, asWeekStart: true })).toBe("next week");
    expect(weekDestination(new Date(2026, 10, 23), { ref: sunday, asWeekStart: true })).toBe("2 weeks out");
    expect(weekDestination(new Date(2026, 11, 7), { ref: sunday, asWeekStart: true })).toBe("4 weeks out");
    expect(weekDestination(new Date(2027, 5, 7), { ref: sunday, asWeekStart: true })).toMatch(/^the week of /);
  });
  it("counts quarters out", () => {
    expect([1, 2, 3].map(quarterDestination)).toEqual(["next quarter", "2 quarters out", "3 quarters out"]);
  });
});
