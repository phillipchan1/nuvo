import { describe, expect, it } from "vitest";
import {
  pushToNextWeekPatch,
  spanAnotherWeekPatch,
  spanWidthWeeks,
  spansWeek,
} from "../supabase/functions/_shared/planningRules.ts";

const WEEK = "2026-07-27"; // Monday

describe("span remediations", () => {
  it("gives a one-week project a second week, still covering this week", () => {
    const p = { startDate: WEEK, targetDate: "2026-07-31" };
    const next = spanAnotherWeekPatch(p, WEEK);
    expect(spanWidthWeeks(p)).toBe(1);
    expect(spanWidthWeeks(next)).toBe(2);
    expect(next.startDate).toBe(WEEK);
    expect(spansWeek(next, WEEK)).toBe(true);
    expect(spansWeek(next, "2026-08-03")).toBe(true);
  });

  it("widens again on a second press", () => {
    const two = spanAnotherWeekPatch({ startDate: WEEK, targetDate: "2026-08-07" }, WEEK);
    expect(spanWidthWeeks(two)).toBe(3);
  });

  it("pushes the whole project out, keeping its width and leaving this week", () => {
    const p = { startDate: WEEK, targetDate: "2026-08-07" }; // 2 weeks
    const next = pushToNextWeekPatch(p, WEEK);
    expect(spanWidthWeeks(next)).toBe(2);
    expect(next.startDate).toBe("2026-08-03");
    expect(spansWeek(next, WEEK)).toBe(false);
    expect(spansWeek(next, "2026-08-03")).toBe(true);
  });

  it("gives a LAPSED project a week that actually reaches this one", () => {
    // The bug: widening a project whose week passed by one week from its own
    // start landed the new finish line still in the past — the row offered the
    // act, the act ran, and nothing moved.
    const p = { startDate: "2026-07-06", targetDate: "2026-07-10" }; // two weeks gone
    const next = spanAnotherWeekPatch(p, WEEK);
    expect(spansWeek(p, WEEK)).toBe(false);
    expect(spansWeek(next, WEEK)).toBe(true);
    expect(next.startDate).toBe("2026-07-06"); // it still started when it started
  });

  it("handles a project with no span yet", () => {
    const next = spanAnotherWeekPatch({ startDate: null, targetDate: null }, WEEK);
    expect(next.startDate).toBe(WEEK);
    expect(spanWidthWeeks(next)).toBe(2);
  });
});
