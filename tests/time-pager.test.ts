import { describe, it, expect } from "vitest";
import { timeDir } from "../src/components/mobile/TimePager";
import { lockAxis, shouldCommitPage, SWIPE_PX } from "../src/components/mobile/swipe";

// Time travel on the phone Calendar: swipe left is later, swipe right is
// earlier. These are the bits that have to stay true if the motion is rewritten
// — a page that commits the wrong way, or a diagonal scroll that steals a
// month, is the jarring "show and hide" wearing a new coat.

describe("timeDir", () => {
  it("reads later as forward for ISO-sortable keys", () => {
    expect(timeDir("2026-07", "2026-08")).toBe("fwd");
    expect(timeDir("2026-08-27", "2026-08-28")).toBe("fwd");
    expect(timeDir("2025", "2026")).toBe("fwd");
  });

  it("reads earlier as back", () => {
    expect(timeDir("2026-08", "2026-07")).toBe("back");
    expect(timeDir("2026-08-27", "2026-08-26")).toBe("back");
  });

  it("is silent on a no-op", () => {
    expect(timeDir("2026-08", "2026-08")).toBeNull();
  });
});

describe("lockAxis", () => {
  it("ignores travel inside the slop — that is still a tap", () => {
    expect(lockAxis(4, 2)).toBeNull();
    expect(lockAxis(0, 0)).toBeNull();
  });

  it("locks horizontal only when it clearly beats vertical", () => {
    expect(lockAxis(-60, 10)).toBe("h");
    expect(lockAxis(60, -8)).toBe("h");
    expect(lockAxis(20, 40)).toBe("v");
  });

  it("refuses a diagonal so a scroll does not steal a page", () => {
    expect(lockAxis(40, 30)).toBeNull();
  });
});

describe("shouldCommitPage", () => {
  it("commits a drag past ~a fifth of the pager", () => {
    expect(shouldCommitPage(-90, 375, 600)).toBe(true);
    expect(shouldCommitPage(90, 375, 600)).toBe(true);
    expect(shouldCommitPage(-20, 375, 600)).toBe(false);
  });

  it("commits a short decisive flick", () => {
    expect(shouldCommitPage(-30, 375, 180)).toBe(true);
    expect(shouldCommitPage(-30, 375, 500)).toBe(false);
  });

  it("agrees with the standing flick distance when width is unknown", () => {
    expect(shouldCommitPage(-SWIPE_PX, 0, 200)).toBe(true);
    expect(shouldCommitPage(-SWIPE_PX + 1, 0, 200)).toBe(false);
  });
});
