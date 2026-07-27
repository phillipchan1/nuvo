// The invariant: a broken provider must never be able to delete its own cache.
//
// This is the rule that was missing on 2026-07-27. iCloud's CalDAV discovery
// returned [] instead of throwing, so `syncAccount` fetched no events, and the
// set-based sweep read "the provider didn't send it" as "it was deleted
// upstream" — 293 rows, gone, logged `ok`. The sweep was behaving correctly;
// nothing above it was willing to say that zero-from-a-provider is not the same
// as an empty calendar.
//
// Run: npm test

import { describe, expect, it } from "vitest";

import { EMPTY_SWEEP_FLOOR, isSuspectWipe } from "../supabase/functions/_shared/sweepSafety.ts";

describe("isSuspectWipe", () => {
  it("refuses the exact 2026-07-27 shape: provider returned nothing, account held 293", () => {
    expect(isSuspectWipe(0, 293)).toBe(true);
  });

  it("allows a sweep whenever the provider reported anything at all", () => {
    // One surviving event means the provider answered; every other deletion in
    // that pass is a real cancellation and must go through.
    expect(isSuspectWipe(1, 293)).toBe(false);
    expect(isSuspectWipe(292, 293)).toBe(false);
  });

  it("still lets a small calendar genuinely empty itself", () => {
    // The false-positive cost is real: refusing here would wedge someone who
    // really did delete their last few events into a permanent sync error.
    expect(isSuspectWipe(0, 0)).toBe(false);
    expect(isSuspectWipe(0, 3)).toBe(false);
    expect(isSuspectWipe(0, EMPTY_SWEEP_FLOOR - 1)).toBe(false);
  });

  it("trips exactly at the floor", () => {
    expect(isSuspectWipe(0, EMPTY_SWEEP_FLOOR)).toBe(true);
  });

  it("keeps a floor that is under any real calendar and over a small cleanup", () => {
    expect(EMPTY_SWEEP_FLOOR).toBeGreaterThan(5);
    expect(EMPTY_SWEEP_FLOOR).toBeLessThan(100);
  });
});
