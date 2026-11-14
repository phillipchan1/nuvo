// One clock for "this block didn't happen" (D-207, docs/rail-line.md §4.3).
// Repair called a block missed the minute it ended; Overdue waited an hour.
// Both now read the kernel's rule, so they flag the same block at the same minute.
import { describe, expect, it } from "vitest";
import { isMissed, MISSED_GRACE_MS, missedAtMs } from "../supabase/functions/_shared/planningRules";
import { isOverdue, OVERDUE_GRACE_MS } from "../supabase/functions/_shared/taskQuery";

const MIN = 60_000;
const end = Date.UTC(2026, 10, 10, 22, 0); // a block that ended

describe("the missed rule", () => {
  it("waits out a short grace after the end", () => {
    expect(isMissed(end, end)).toBe(false);
    expect(isMissed(end, end + 14 * MIN)).toBe(false);
    expect(isMissed(end, end + MISSED_GRACE_MS)).toBe(true);
  });

  it("calls it sooner when your next block has started", () => {
    const next = end + 5 * MIN;
    expect(missedAtMs(end, next)).toBe(next);
    expect(isMissed(end, end + 4 * MIN, next)).toBe(false);
    expect(isMissed(end, end + 5 * MIN, next)).toBe(true);
  });

  it("ignores a next block that starts after the grace, or before the end", () => {
    expect(missedAtMs(end, end + 40 * MIN)).toBe(end + MISSED_GRACE_MS);
    expect(missedAtMs(end, end - 10 * MIN)).toBe(end + MISSED_GRACE_MS);
  });

  it("is the same clock Overdue reads", () => {
    expect(OVERDUE_GRACE_MS).toBe(MISSED_GRACE_MS);
    const block = { start_time: new Date(end - 30 * MIN).toISOString(), duration_minutes: 30, status: "planned" };
    for (const dt of [0, 5, 14, 15, 16, 90]) {
      expect(isOverdue(block, end + dt * MIN)).toBe(isMissed(end, end + dt * MIN));
    }
  });
});
