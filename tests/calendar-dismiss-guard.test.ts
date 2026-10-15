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

  it("outlives FullCalendar's deferred dateClick (a timer after mouseup)", () => {
    vi.useFakeTimers();
    markCalendarClickHandled();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    // FullCalendar's dateClick runs from a setTimeout(0) scheduled at mouseup —
    // after anything pointerup scheduled. The mark must still be there for it.
    vi.runAllTimers();
    expect(consumeCalendarClickHandled()).toBe(true);
  });

  it("is dropped at the next press, so a dismiss off the grid cannot eat the next create", () => {
    markCalendarClickHandled();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(consumeCalendarClickHandled()).toBe(false);
  });
});
