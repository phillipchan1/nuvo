import { describe, expect, it } from "vitest";
import {
  DAY_HOUR_PX,
  TAP_SNAP_MINS,
  dateAtMinutes,
  isCanvasTap,
  minutesFromCanvasY,
} from "../src/components/mobile/canvasTap";
import { AXIS_SLOP_PX } from "../src/components/mobile/swipe";

describe("minutesFromCanvasY", () => {
  const top = 100;
  const winStart = 8 * 60; // 8am, the usual working-window top

  it("reads the slot the tap is in, not the nearest line", () => {
    // One hour below the canvas top is 9:00. A tap 2px under that line is
    // still 9:00 — nearest-rounding would have sent it back to 8:45.
    expect(minutesFromCanvasY(top + DAY_HOUR_PX, top, winStart)).toBe(9 * 60);
    expect(minutesFromCanvasY(top + DAY_HOUR_PX + 2, top, winStart)).toBe(9 * 60);
  });

  it("lands on each 15-minute band inside the hour", () => {
    const hour = top + DAY_HOUR_PX; // 9:00
    const q = DAY_HOUR_PX / 4; // 15 min in px
    expect(minutesFromCanvasY(hour + q, top, winStart)).toBe(9 * 60 + 15);
    expect(minutesFromCanvasY(hour + 2 * q, top, winStart)).toBe(9 * 60 + 30);
    expect(minutesFromCanvasY(hour + 3 * q, top, winStart)).toBe(9 * 60 + 45);
  });

  it("clamps to the visible window so a tap past the last rule is still a time", () => {
    // Above the 8am rule is still 8am — not midnight, which the canvas
    // isn't even drawing.
    expect(minutesFromCanvasY(top - 40, top, winStart)).toBe(winStart);
    expect(minutesFromCanvasY(top + 40 * DAY_HOUR_PX, top, 0)).toBe(24 * 60 - TAP_SNAP_MINS);
  });
});

describe("dateAtMinutes", () => {
  it("stamps the clock onto the day that was showing, not today", () => {
    const thu = new Date(2026, 8, 3); // Thursday Sep 3
    const at = dateAtMinutes(thu, 14 * 60 + 30);
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(8);
    expect(at.getDate()).toBe(3);
    expect(at.getHours()).toBe(14);
    expect(at.getMinutes()).toBe(30);
  });
});

describe("isCanvasTap", () => {
  it("agrees with TimePager about how far a finger may wander", () => {
    expect(isCanvasTap(0, 0)).toBe(true);
    expect(isCanvasTap(AXIS_SLOP_PX, 0)).toBe(true);
    expect(isCanvasTap(AXIS_SLOP_PX + 1, 0)).toBe(false);
    expect(isCanvasTap(0, 24)).toBe(false);
  });
});
