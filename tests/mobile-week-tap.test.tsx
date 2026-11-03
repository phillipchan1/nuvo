// @vitest-environment jsdom
/**
 * Empty-space tap on the Week canvas claims that time on that column's day
 * (D-175, extending D-130). A tap on a block still opens the block; a wander
 * is a scroll or a page-swipe, never a create; the gutter claims nothing.
 */
import { fireEvent, render } from "@testing-library/react";
import { addDays, startOfDay, startOfWeek } from "date-fns";
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
import MobileWeekView from "../src/components/mobile/MobileWeekView";
import { CAL_GUTTER } from "../src/components/mobile/CalendarChrome";
import { columnFromCanvasX } from "../src/components/mobile/canvasTap";
import type { DayCtx } from "../src/components/mobile/dayPlan";
import type { Slot, Task } from "../src/lib/types";

const weekStart = startOfWeek(startOfDay(new Date()), { weekStartsOn: 0 });
const NOW = new Date(weekStart.getTime() + (10 * 60 + 15) * 60_000);
// Wednesday 1pm, 90 minutes.
const wed1pm = new Date(addDays(weekStart, 3).getTime() + 13 * 60 * 60_000).toISOString();

const CTX: DayCtx = {
  visibleEvents: [],
  blocks: [{ id: "t1", title: "Write launch notes", start_time: wed1pm, duration_minutes: 90, status: "ready" } as Task],
  anytime: [],
  slots: [] as Slot[],
  slotChildren: {},
  slotTitles: new Map(),
  hidden: new Set(),
  workStart: 8 * 60,
  workEnd: 16 * 60 + 30,
  now: NOW,
};

const HOUR = 52; // the Week lens's HOUR_PX
const WIDTH = CAL_GUTTER + 7 * 50; // seven 50px columns past the gutter
const colX = (i: number) => CAL_GUTTER + i * 50 + 25;

function mount(onTapEmpty = vi.fn()) {
  const view = render(
    <MobileWeekView
      weekStart={weekStart}
      ctx={CTX}
      stickyPx={0}
      onPrev={() => {}}
      onNext={() => {}}
      onTapEmpty={onTapEmpty}
    />,
  );
  const canvas = view.container.querySelector("[data-week-canvas]") as HTMLElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    top: 0, left: 0, right: WIDTH, bottom: 800, width: WIDTH, height: 800, x: 0, y: 0, toJSON: () => {},
  });
  return { view, canvas, onTapEmpty };
}

function tap(el: HTMLElement, clientX: number, clientY: number) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX, clientY });
  fireEvent.pointerUp(el, { button: 0, pointerId: 1, clientX, clientY });
}

describe("columnFromCanvasX", () => {
  it("reads the column a point is in, and nothing in the gutter", () => {
    expect(columnFromCanvasX(CAL_GUTTER - 1, 0, WIDTH, CAL_GUTTER)).toBeNull();
    expect(columnFromCanvasX(CAL_GUTTER, 0, WIDTH, CAL_GUTTER)).toBe(0);
    expect(columnFromCanvasX(colX(4), 0, WIDTH, CAL_GUTTER)).toBe(4);
    expect(columnFromCanvasX(WIDTH + 10, 0, WIDTH, CAL_GUTTER)).toBe(6);
  });
});

describe("week canvas empty-space tap", () => {
  it("opens capture on that column's day, at the half-hour the tap is in", () => {
    const { canvas, onTapEmpty } = mount();
    // Thursday column; window starts at 8am, so 2h + a bit is 10:00, and
    // 2h + 35min of height is still the 10:30 band.
    tap(canvas, colX(4), 2 * HOUR + (35 / 60) * HOUR);
    expect(onTapEmpty).toHaveBeenCalledTimes(1);
    const start = onTapEmpty.mock.calls[0][0] as Date;
    expect(startOfDay(start).getTime()).toBe(addDays(weekStart, 4).getTime());
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(30);
  });

  it("shows the ghost in the pressed column before release", () => {
    const { canvas, view } = mount();
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: colX(2), clientY: HOUR });
    expect(view.container.querySelector("[data-week-draft]")).not.toBeNull();
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    expect(view.container.querySelector("[data-week-draft]")).toBeNull();
  });

  it("does not create when the finger wandered (a scroll or a page-swipe)", () => {
    const { canvas, onTapEmpty } = mount();
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: colX(1), clientY: HOUR });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: colX(1) + 30, clientY: HOUR });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX: colX(1) + 30, clientY: HOUR });
    expect(onTapEmpty).not.toHaveBeenCalled();
  });

  it("does not claim from the hour gutter", () => {
    const { canvas, onTapEmpty } = mount();
    tap(canvas, CAL_GUTTER - 4, HOUR);
    expect(onTapEmpty).not.toHaveBeenCalled();
  });

  it("does not steal a tap that landed on a block", () => {
    const { onTapEmpty, view } = mount();
    const block = view.container.querySelector("[data-cal-item]") as HTMLElement;
    tap(block, colX(3), 5 * HOUR);
    expect(onTapEmpty).not.toHaveBeenCalled();
  });
});
