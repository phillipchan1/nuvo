/** @vitest-environment jsdom */
/**
 * The Year's marks: day numerals are the map (D-127); density is gone (D-128);
 * the desktop Year fills its pane (D-129); the year numeral sits on the
 * map (D-132).
 *
 * These assertions hold the coordinate layer — every day gets a number, on
 * both shells, with no load legend, and months stretch the weeks they have
 * (no trailing empty sixth week). jsdom has no layout, so they cannot
 * prove a glyph survives a cell; that is ?year.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YearMonth } from "../src/components/calendar/YearParts";
import CalendarYear from "../src/components/CalendarYear";
import MobileYearView from "../src/components/mobile/MobileYearView";

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

describe("YearMonth numerals", () => {
  it("draws every day-of-month by default", () => {
    const c = render(<YearMonth month={JAN} now={NOW} weekStartsOn={0} />);
    expect(c.getByText("1")).toBeTruthy();
    expect(c.getByText("15")).toBeTruthy();
    expect(c.getByText("31")).toBeTruthy();
  });

  it("can still mute the index", () => {
    const c = render(
      <YearMonth month={JAN} now={NOW} weekStartsOn={0} showNumbers={false} />,
    );
    expect(c.queryByText("15")).toBeNull();
    expect(c.queryByText("31")).toBeNull();
  });

  it("labels the columns when numerals are on", () => {
    const c = render(<YearMonth month={JAN} now={NOW} weekStartsOn={0} />);
    // Narrow weekday initials — locale-dependent, but there are seven of them
    // in the header row. A grid of 1–31 with no weekday row is texture.
    const header = c.container.querySelector(".grid.grid-cols-7");
    expect(header?.childElementCount).toBe(7);
  });

  it("pads every month to six weeks so a year row shares one dense footprint", () => {
    // Jan 2026 starts Thursday → 4 lead + 31 days + 7 trail = 42. Empty
    // trailing cells stay compact (square-capped), so they align months
    // without reading as dead paper under December.
    const c = render(<YearMonth month={JAN} now={NOW} weekStartsOn={0} fill />);
    const grids = c.container.querySelectorAll(".grid.grid-cols-7");
    expect(grids.length).toBe(2);
    expect(grids[1]?.childElementCount).toBe(42);
  });
});

describe("both shells wear the same index — and no density", () => {
  it("the desktop Year draws day numbers and no load legend", () => {
    const c = render(
      <CalendarYear
        year={2026}
        now={NOW}
        weekStartsOn={0}
        onPickDay={() => {}}
        onPickMonth={() => {}}
      />,
    );
    expect(c.getAllByText("15").length).toBe(12);
    // The year is written on the map (D-132) — once, not on every month —
    // because year grids are not self-identifying when you page.
    expect(c.getAllByLabelText("Year 2026")).toHaveLength(1);
    expect(c.queryByText("nothing on")).toBeNull();
    expect(c.queryByText("busy")).toBeNull();
    expect(c.queryByText("overcommitted")).toBeNull();
  });

  it("the phone Year draws day numbers and no load legend", () => {
    const c = render(
      <MobileYearView
        year={2026}
        now={NOW}
        weekStartsOn={0}
        onPickMonth={() => {}}
        onPrev={() => {}}
        onNext={() => {}}
      />,
    );
    expect(c.getAllByText("15").length).toBe(12);
    expect(c.getAllByLabelText("Year 2026")).toHaveLength(1);
    expect(c.queryByText("nothing on")).toBeNull();
    expect(c.queryByText("busy")).toBeNull();
  });
});
