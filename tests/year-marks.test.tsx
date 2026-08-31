/** @vitest-environment jsdom */
/**
 * The Year's marks: shade is the read, the numeral is the index (D-127).
 *
 * A year of anonymous squares is a picture. These assertions hold the
 * coordinate layer — every day gets a number, on both shells, and the
 * opt-out still exists for a mute sketch. jsdom has no layout, so they
 * cannot prove a 9.5px glyph survives a 17px cell; that is ?year.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YearMonth, type DayLoad } from "../src/components/calendar/YearParts";
import CalendarYear from "../src/components/CalendarYear";
import MobileYearView from "../src/components/mobile/MobileYearView";
import type { DayCtx } from "../src/components/mobile/dayPlan";
import type { Slot, Task } from "../src/lib/types";

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

const NOW = new Date(2026, 7, 31, 10, 15);
const JAN = new Date(2026, 0, 1);

const emptyLoads: DayLoad[] = [];

const CTX: DayCtx = {
  visibleEvents: [],
  blocks: [] as Task[],
  anytime: [],
  slots: [] as Slot[],
  slotChildren: {},
  slotTitles: new Map(),
  hidden: new Set(),
  workStart: 8 * 60,
  workEnd: 16 * 60 + 30,
  now: NOW,
};

describe("YearMonth numerals", () => {
  it("draws every day-of-month by default", () => {
    const c = render(
      <YearMonth month={JAN} loads={emptyLoads} now={NOW} weekStartsOn={0} />,
    );
    expect(c.getByText("1")).toBeTruthy();
    expect(c.getByText("15")).toBeTruthy();
    expect(c.getByText("31")).toBeTruthy();
  });

  it("can still mute the index", () => {
    const c = render(
      <YearMonth
        month={JAN}
        loads={emptyLoads}
        now={NOW}
        weekStartsOn={0}
        showNumbers={false}
      />,
    );
    expect(c.queryByText("15")).toBeNull();
    expect(c.queryByText("31")).toBeNull();
  });

  it("labels the columns when numerals are on", () => {
    const c = render(
      <YearMonth month={JAN} loads={emptyLoads} now={NOW} weekStartsOn={0} />,
    );
    // Narrow weekday initials — locale-dependent, but there are seven of them
    // in the header row. A grid of 1–31 with no weekday row is texture.
    const header = c.container.querySelector(".grid.grid-cols-7");
    expect(header?.childElementCount).toBe(7);
  });
});

describe("both shells wear the same index", () => {
  it("the desktop Year draws day numbers", () => {
    const c = render(
      <CalendarYear
        year={2026}
        ctx={CTX}
        now={NOW}
        weekStartsOn={0}
        onPickDay={() => {}}
        onPickMonth={() => {}}
      />,
    );
    // Twelve months each have a 15th — if numerals were off this is empty.
    expect(c.getAllByText("15").length).toBe(12);
    expect(c.getByText("2026")).toBeTruthy();
  });

  it("the phone Year draws day numbers too — it used to pass showNumbers={false}", () => {
    const c = render(
      <MobileYearView
        year={2026}
        ctx={CTX}
        now={NOW}
        weekStartsOn={0}
        onPickMonth={() => {}}
        onPrev={() => {}}
        onNext={() => {}}
      />,
    );
    expect(c.getAllByText("15").length).toBe(12);
  });
});
