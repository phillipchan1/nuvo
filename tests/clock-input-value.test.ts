/**
 * A time picker prefills the LOCAL clock. `iso.slice(11, 16)` read UTC — a 9am
 * block in Pasadena opened its picker at 17:00 (phone task sheet, phone slot
 * sheet, desktop rail). One helper now, for all three.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clockInputValue } from "../src/lib/dates";

const realTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  process.env.TZ = realTZ;
});

describe("clockInputValue", () => {
  it("reads the wall clock where you are, not UTC", () => {
    // 9:00am PST on Nov 5 is 17:00Z.
    expect(clockInputValue("2026-11-05T17:00:00.000Z")).toBe("09:00");
    expect("2026-11-05T17:00:00.000Z".slice(11, 16)).toBe("17:00"); // the old, wrong read
  });
  it("is empty for nothing", () => {
    expect(clockInputValue(null)).toBe("");
    expect(clockInputValue("not a date")).toBe("");
  });
  it("guards every picker that used the slice", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "src/components/LeftRail.tsx",
      "src/components/mobile/MobileTaskSheet.tsx",
      "src/components/mobile/MobileEventSheet.tsx",
    ]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/start_time\??\.slice\(11, ?16\)/);
    }
  });
});
