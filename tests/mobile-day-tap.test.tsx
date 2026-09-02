// @vitest-environment jsdom
/**
 * Empty-space tap on the Day canvas claims that time (D-130). A tap on a
 * block still opens the block; a wander is a scroll, not a create.
 */
import { fireEvent, render } from "@testing-library/react";
import { startOfDay } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realRO = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = realRO;
});
import MobileDayView from "../src/components/mobile/MobileDayView";
import { CAL_GUTTER } from "../src/components/mobile/CalendarChrome";
import { DAY_HOUR_PX } from "../src/components/mobile/canvasTap";
import type { DayCtx } from "../src/components/mobile/dayPlan";
import type { Slot, Task } from "../src/lib/types";

const today = startOfDay(new Date());
const NOW = new Date(today.getTime() + (10 * 60 + 15) * 60_000);
const iso = (h: number, m = 0) => new Date(today.getTime() + (h * 60 + m) * 60_000).toISOString();

const CTX: DayCtx = {
  visibleEvents: [],
  blocks: [
    { id: "t1", title: "Write launch notes", start_time: iso(13), duration_minutes: 90, status: "ready" } as Task,
  ],
  anytime: [],
  slots: [] as Slot[],
  slotChildren: {},
  slotTitles: new Map(),
  hidden: new Set(),
  workStart: 8 * 60,
  workEnd: 16 * 60 + 30,
  now: NOW,
};

function mount(onTapEmpty = vi.fn()) {
  const view = render(
    <MobileDayView
      selected={today}
      ctx={CTX}
      stickyPx={0}
      onPrev={() => {}}
      onNext={() => {}}
      onTapEmpty={onTapEmpty}
    />,
  );
  const canvas = view.container.querySelector("[data-day-canvas]") as HTMLElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 300,
    bottom: 800,
    width: 300,
    height: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
  return { view, canvas, onTapEmpty };
}

function tap(canvas: HTMLElement, clientX: number, clientY: number) {
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX, clientY });
  fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX, clientY });
}

describe("day canvas empty-space tap", () => {
  it("opens capture at the 15-minute slot the tap is in", () => {
    const { canvas, onTapEmpty } = mount();
    // Working window starts at 8am; one hour down is 9:00, x past the gutter.
    tap(canvas, CAL_GUTTER + 20, DAY_HOUR_PX);
    expect(onTapEmpty).toHaveBeenCalledTimes(1);
    const start = onTapEmpty.mock.calls[0][0] as Date;
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(0);
  });

  it("does not create when the finger wandered (that was a scroll)", () => {
    const { canvas, onTapEmpty } = mount();
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: CAL_GUTTER + 20, clientY: DAY_HOUR_PX });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: CAL_GUTTER + 20, clientY: DAY_HOUR_PX + 24 });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX: CAL_GUTTER + 20, clientY: DAY_HOUR_PX + 24 });
    expect(onTapEmpty).not.toHaveBeenCalled();
  });

  it("does not steal a tap that landed on a block", () => {
    const { canvas, onTapEmpty, view } = mount();
    const block = view.container.querySelector("[data-cal-item]") as HTMLElement;
    fireEvent.pointerDown(block, { button: 0, pointerId: 1, clientX: CAL_GUTTER + 20, clientY: 5 * DAY_HOUR_PX });
    fireEvent.pointerUp(block, { button: 0, pointerId: 1, clientX: CAL_GUTTER + 20, clientY: 5 * DAY_HOUR_PX });
    expect(onTapEmpty).not.toHaveBeenCalled();
  });
});
