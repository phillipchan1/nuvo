/** @vitest-environment jsdom */

// Same-gesture dismiss vs create: a popover mousedown marks the click so a
// tap on the grid doesn't also open a draft. A drag-select must still create,
// and a mark that never hits the grid must not leak into the next gesture.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeCalendarClickHandled,
  markCalendarClickHandled,
} from "../src/lib/calendarDismissGuard";

afterEach(() => {
  consumeCalendarClickHandled();
  vi.useRealTimers();
});

describe("calendarDismissGuard", () => {
  it("is consumed once, then clear", () => {
    expect(consumeCalendarClickHandled()).toBe(false);
    markCalendarClickHandled();
    expect(consumeCalendarClickHandled()).toBe(true);
    expect(consumeCalendarClickHandled()).toBe(false);
  });

  it("expires after pointerup so a dismiss off the grid cannot eat the next create", () => {
    vi.useFakeTimers();
    markCalendarClickHandled();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(consumeCalendarClickHandled()).toBe(true);

    markCalendarClickHandled();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    vi.runAllTimers();
    expect(consumeCalendarClickHandled()).toBe(false);
  });
});
