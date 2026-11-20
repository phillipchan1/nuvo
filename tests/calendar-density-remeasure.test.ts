import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The hour gutter said 8am where a 9:05 block was drawn at ~8:20.
 *
 * `--nuvo-hour` (pxPerHour) sizes the slats in CSS; FullCalendar places every
 * block in px from slat coordinates it measured once. `updateSize()` and a window
 * resize do NOT re-read slats for a height-only change (verified against
 * FullCalendar 6.1.21), so any density change after the first measure left every
 * block at oldDensity/newDensity of where it belonged — wrong more the later in
 * the day, with the gutter and the grid lines still agreeing with each other.
 *
 * Only a real option change re-measures, and a repeated value is deduped — so the
 * fix alternates an interaction-only option. Layout can't run in vitest; this
 * pins the wiring so a "cleanup" can't quietly delete it.
 */
const SRC = readFileSync(resolve(__dirname, "../src/components/CalendarPane.tsx"), "utf8");

describe("FullCalendar re-measures when the slot height changes", () => {
  const at = SRC.indexOf("remeasureFlip");
  const effect = at < 0 ? "" : SRC.slice(at, SRC.indexOf("}, [", at) + 40);

  it("has an effect that re-measures on pxPerHour (and the UI zoom)", () => {
    expect(at, "CalendarPane lost its density re-measure").toBeGreaterThan(-1);
    expect(effect).toContain("[pxPerHour, uiScale]");
  });

  it("does it with a value that changes every time (a repeat is a no-op)", () => {
    expect(effect).toContain('setOption("longPressDelay"');
    expect(effect).toMatch(/\.current = !remeasureFlip\.current/);
  });

  it("is coalesced to one call per frame and cancelled on cleanup", () => {
    expect(effect).toContain("requestAnimationFrame");
    expect(effect).toContain("cancelAnimationFrame");
  });

  it("still drives the slot height from --nuvo-hour (so this guard stays relevant)", () => {
    expect(SRC).toContain('"--nuvo-hour": `${pxPerHour}px`');
  });
});
