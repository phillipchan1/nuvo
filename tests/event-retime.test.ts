/**
 * An event never ends at or before it starts.
 *
 *  • Both inspectors set the start on its own and left the end where it was:
 *    a 9–10 moved to 11 saved as 11–10. The end now moves with the start.
 *  • Both inspectors saved any end picked, even one before the start. Refused.
 *  • The capture door's composer applied a picked end to the OLD end's day: an
 *    11pm event (seeded to end at midnight, the next day) given an 11:30pm end
 *    became 24½ hours. The end now goes on the start's day, and only wraps to
 *    the next day when the clock does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { endFromStart, moveStartTo, setEndTo } from "../src/components/mobile/dayPlan";

// Pinned to America/Los_Angeles by vitest.config.ts; built from the local clock.
const local = (y: number, mo: number, d: number, h: number, m = 0) => new Date(y, mo - 1, d, h, m).toISOString();
const mins = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

describe("moveStartTo", () => {
  it("moves the end by the same amount, keeping the length", () => {
    const next = moveStartTo(local(2026, 11, 17, 9), local(2026, 11, 17, 10), "11:00");
    expect(next).toEqual({ start_at: local(2026, 11, 17, 11), end_at: local(2026, 11, 17, 12) });
  });

  it("keeps a block crossing midnight intact", () => {
    const next = moveStartTo(local(2026, 11, 17, 23), local(2026, 11, 18, 1), "22:30");
    expect(mins(next.start_at, next.end_at)).toBe(120);
    expect(next.start_at).toBe(local(2026, 11, 17, 22, 30));
  });
});

describe("setEndTo", () => {
  it("sets the end on its own day", () => {
    expect(setEndTo(local(2026, 11, 17, 9), local(2026, 11, 17, 10), "10:45")).toEqual({
      start_at: local(2026, 11, 17, 9),
      end_at: local(2026, 11, 17, 10, 45),
    });
  });

  it("refuses an end at or before the start", () => {
    expect(setEndTo(local(2026, 11, 17, 9), local(2026, 11, 17, 10), "08:00")).toBeNull();
    expect(setEndTo(local(2026, 11, 17, 9), local(2026, 11, 17, 10), "09:00")).toBeNull();
  });
});

describe("endFromStart (the composer)", () => {
  it("an 11pm event given an 11:30pm end is 30 minutes, not 24½ hours", () => {
    const start = local(2026, 11, 17, 23);
    expect(endFromStart(start, "23:30")).toBe(local(2026, 11, 17, 23, 30));
    expect(mins(start, endFromStart(start, "23:30"))).toBe(30);
  });

  it("wraps to the next day only when the clock does", () => {
    const start = local(2026, 11, 17, 23);
    expect(endFromStart(start, "00:30")).toBe(local(2026, 11, 18, 0, 30));
    expect(endFromStart(local(2026, 11, 17, 9), "10:00")).toBe(local(2026, 11, 17, 10));
  });

  it("lands on the wall clock across a DST change", () => {
    // Nov 1 2026 falls back in Los Angeles; 11pm Oct 31 → 1:30am is 3.5 hours.
    const start = local(2026, 10, 31, 23);
    expect(new Date(endFromStart(start, "01:30")).getHours()).toBe(1);
  });
});

describe("the three time controls use these rules", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  it("the desktop inspector", () => {
    const s = src("src/components/SlideOver.tsx");
    expect(s).toMatch(/moveStartTo\(startAt, endAt, hhmm\)/);
    expect(s).toMatch(/setEndTo\(startAt, endAt, hhmm\)/);
  });
  it("the phone sheet", () => {
    const s = src("src/components/mobile/MobileEventSheet.tsx");
    expect(s).toMatch(/moveStartTo\(startAt, endAt, e\.target\.value\)/);
    expect(s).toMatch(/setEndTo\(startAt, endAt, e\.target\.value\)/);
  });
  it("the composer", () => {
    expect(src("src/components/mobile/EventComposer.tsx")).toMatch(/endFromStart\(startAt, e\.target\.value\)/);
  });
});
