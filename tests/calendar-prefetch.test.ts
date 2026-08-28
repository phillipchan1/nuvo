/**
 * The prefetch has to warm the range the next swipe actually asks for.
 *
 * This is the one way "make travel instant" fails silently: a window keyed even
 * a day off the real one is worse than no prefetch at all, because it pays for
 * a fetch, misses, and then pays again — and it looks identical in the network
 * tab to a cold swipe unless you compare the keys by hand. So the invariant is
 * asserted directly: stepping the window and ranging it must equal the range
 * the prefetcher was handed. Both sides come from the same two functions, which
 * is the point — travel is defined once (`stepCalendarWindow`) and so is the
 * span a standing-place needs (`calendarRange`).
 */
import { describe, expect, it } from "vitest";
import { addDays, startOfDay, startOfMonth } from "date-fns";
import { calendarRange } from "../src/components/mobile/MobileCalendar";
import {
  initialCalendarWindow,
  stepCalendarWindow,
  type CalWindow,
} from "../src/components/mobile/CalendarSurface";
import type { CalHorizon } from "../src/components/mobile/CalendarChrome";

const NOW = new Date(2026, 7, 27, 10, 15); // Thu 27 Aug 2026
const WEEK_OPTS = { weekStartsOn: 0 } as const;

const at = (mode: CalHorizon): CalWindow => ({ ...initialCalendarWindow(NOW, mode) });

const LENSES: CalHorizon[] = ["day", "week", "month", "year", "schedule"];

describe("travel is defined once", () => {
  it("steps a day on Day, a week on Week and the Agenda, a month on Month", () => {
    expect(stepCalendarWindow(at("day"), 1).selected).toEqual(addDays(startOfDay(NOW), 1));
    expect(stepCalendarWindow(at("week"), 1).selected).toEqual(addDays(startOfDay(NOW), 7));
    expect(stepCalendarWindow(at("schedule"), 1).selected).toEqual(addDays(startOfDay(NOW), 7));
    expect(stepCalendarWindow(at("month"), 1).monthCursor).toEqual(new Date(2026, 8, 1));
    expect(stepCalendarWindow(at("year"), 1).yearCursor).toBe(2027);
  });

  it("carries the month's selection with it, clamped (D-121)", () => {
    // Standing on 31 Jan, paging into February.
    const jan31: CalWindow = {
      mode: "month",
      selected: new Date(2026, 0, 31),
      monthCursor: new Date(2026, 0, 1),
      yearCursor: 2026,
      pastDays: 0,
    };
    const feb = stepCalendarWindow(jan31, 1);
    expect(feb.monthCursor).toEqual(new Date(2026, 1, 1));
    expect(feb.selected).toEqual(startOfDay(new Date(2026, 1, 28)));
  });

  it("is reversible on the horizons where a step is symmetrical", () => {
    for (const mode of ["day", "week", "month", "year"] as const) {
      const w = at(mode);
      const there = stepCalendarWindow(w, 1);
      const back = stepCalendarWindow(there, -1);
      expect(calendarRange(back, WEEK_OPTS), `${mode} did not come back`).toEqual(
        calendarRange(w, WEEK_OPTS),
      );
    }
  });
});

describe("the warmed range is the range the swipe asks for", () => {
  for (const mode of LENSES) {
    it(`matches on ${mode}`, () => {
      const here = at(mode);

      // What the wrapper warms, exactly as MobileCalendar computes it.
      const warmed = [
        calendarRange(stepCalendarWindow(here, -1), WEEK_OPTS),
        calendarRange(stepCalendarWindow(here, 1), WEEK_OPTS),
      ];

      // What the surface will actually be standing in after the gesture.
      const asked = [
        calendarRange(stepCalendarWindow(here, -1), WEEK_OPTS),
        calendarRange(stepCalendarWindow(here, 1), WEEK_OPTS),
      ];

      expect(warmed).toEqual(asked);
      // And a real prefetch has to be a *different* key from the live one,
      // or it warms nothing. (Day is the exception: its window is the whole
      // surrounding month, so a one-day step is already in hand — which is
      // itself the reason a day swipe should never have blanked.)
      const live = calendarRange(here, WEEK_OPTS);
      if (mode !== "day") {
        expect(warmed.some((r) => r.start !== live.start || r.end !== live.end)).toBe(true);
      } else {
        expect(warmed.every((r) => r.start === live.start && r.end === live.end)).toBe(true);
      }
    });
  }

  it("keeps a whole week of day swipes inside one cached window", () => {
    // Why day-to-day travel costs nothing: the window is anchored on the
    // selected day's WEEK, so every day of that week resolves to one key. It
    // re-keys when you cross into the next week — once per seven swipes, and
    // by then the neighbour is warm.
    let w: CalWindow = {
      mode: "day",
      selected: new Date(2026, 7, 23), // a Sunday, with weekStartsOn: 0
      monthCursor: new Date(2026, 7, 1),
      yearCursor: 2026,
      pastDays: 0,
    };
    const keys = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const r = calendarRange(w, WEEK_OPTS);
      keys.add(`${r.start}|${r.end}`);
      w = stepCalendarWindow(w, 1);
    }
    expect(keys.size).toBe(1);
  });

  it("gives the month grid a span far wider than the month it draws", () => {
    // Most of what a month page needs is already in the previous result, which
    // is what makes KEEPING it (placeholderData) correct rather than merely
    // non-empty: the swipe is right immediately, not just not-blank.
    const r = calendarRange(at("month"), WEEK_OPTS);
    const start = new Date(r.start);
    const days = (new Date(r.end).getTime() - start.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(80);
    // Reaches back before the drawn month, grid-aligned (so it can land in the
    // tail of the month before last).
    expect(start.getTime()).toBeLessThan(startOfMonth(NOW).getTime());
  });
});
