import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIECE_MINUTES,
  sizeSlotToContents,
  sizeSlotToCount,
} from "../supabase/functions/_shared/slotSizing";

// A block that holds work has to be big enough to hold it — and the browser
// and the agent have to agree, or "drop four things on 9am" and "make me a 9am
// block with four things in it" produce two different mornings.

describe("sizeSlotToContents — a block covers its contents", () => {
  it("sums the pieces rather than counting them", () => {
    // Three 15-minute errands are 45 minutes, not an hour and a half.
    expect(sizeSlotToContents([15, 15, 15])).toBe(45);
    expect(sizeSlotToContents([60, 30, 45])).toBe(135);
  });

  it("counts an unstated piece as the default", () => {
    expect(sizeSlotToContents([null, undefined])).toBe(2 * DEFAULT_PIECE_MINUTES);
    expect(sizeSlotToContents([60, null])).toBe(90);
  });

  it("holds a 30-minute floor — below that isn't time you defended", () => {
    expect(sizeSlotToContents([5])).toBe(30);
    expect(sizeSlotToContents([])).toBe(30);
  });

  it("lands on the grid's quarter hour", () => {
    expect(sizeSlotToContents([20, 20])).toBe(45);
    expect(sizeSlotToContents([50, 50])).toBe(105);
    expect(sizeSlotToContents([31])).toBe(45);
  });

  it("treats a zero or negative duration as the default, not as nothing", () => {
    expect(sizeSlotToContents([0, 0])).toBe(60);
    expect(sizeSlotToContents([-30])).toBe(30);
  });
});

describe("sizeSlotToCount — the same rule for a caller that only has a count", () => {
  it("matches the old count-based sizing the chat shipped with", () => {
    expect(sizeSlotToCount(1)).toBe(30);
    expect(sizeSlotToCount(2)).toBe(60);
    expect(sizeSlotToCount(3)).toBe(90);
    expect(sizeSlotToCount(0)).toBe(30); // a block always holds something
  });

  it("agrees with the duration-based form when every piece is a default", () => {
    for (const n of [1, 2, 5, 9]) {
      expect(sizeSlotToCount(n)).toBe(sizeSlotToContents(new Array(n).fill(null)));
    }
  });
});
