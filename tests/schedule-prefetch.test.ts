/**
 * The desktop Schedule warms its neighbours under the keys FullCalendar will
 * report — or it warms nothing.
 *
 * The failure is silent: a neighbour keyed an hour off (millisecond arithmetic
 * across a DST change) pays for a fetch, misses, then pays again, and in the
 * network tab looks exactly like a cold page. So the invariant is asserted
 * directly: stepping a range must equal the range the view draws standing on
 * the day you stepped to. Both are local calendar-day math; run this under a
 * DST zone (`TZ=America/Los_Angeles npx vitest run schedule-prefetch`) to see
 * the Nov 1 case bite if that ever regresses.
 */
import { describe, expect, it } from "vitest";
import { addDays, addMonths } from "date-fns";
import { scheduleNeighbours, scheduleRangeFor } from "../src/lib/scheduleRange";

const THU = new Date(2026, 8, 24, 10, 15); // Thu 24 Sep 2026

describe("scheduleRangeFor draws what FullCalendar draws", () => {
  it("a week is seven days from the configured first day, at local midnight", () => {
    for (const ws of [0, 1] as const) {
      const r = scheduleRangeFor("timeGridWeek", THU, ws);
      const start = new Date(r.start);
      expect(start.getDay()).toBe(ws);
      expect(start.getHours()).toBe(0);
      expect(new Date(r.end).getTime()).toBe(addDays(start, 7).getTime());
    }
  });

  it("a month is the fixed six-week grid holding the 1st", () => {
    const r = scheduleRangeFor("dayGridMonth", THU, 0);
    const start = new Date(r.start);
    expect(start.getDay()).toBe(0);
    expect(start <= new Date(2026, 8, 1)).toBe(true);
    expect(new Date(r.end).getTime()).toBe(addDays(start, 42).getTime());
  });

  it("the non-FullCalendar views key on the week, never on 'now'", () => {
    expect(scheduleRangeFor("board", THU, 0)).toEqual(scheduleRangeFor("timeGridWeek", THU, 0));
    expect(scheduleRangeFor("year", THU, 0)).toEqual(scheduleRangeFor("timeGridWeek", THU, 0));
  });
});

describe("a warmed neighbour is the range the press lands on", () => {
  const cases = [
    { view: "timeGridWeek", unit: (d: Date, n: number) => addDays(d, 7 * n) },
    { view: "timeGridDay", unit: (d: Date, n: number) => addDays(d, n) },
    { view: "dayGridMonth", unit: (d: Date, n: number) => addMonths(d, n) },
  ];
  for (const { view, unit } of cases) {
    it(`on ${view}, two steps each way`, () => {
      const here = scheduleRangeFor(view, THU, 1);
      const warmed = scheduleNeighbours(here, 1, [1, -1, 2, -2]);
      const landed = [1, -1, 2, -2].map((n) => scheduleRangeFor(view, unit(THU, n), 1));
      expect(warmed).toEqual(landed);
    });
  }

  it("across the autumn DST change (Nov 1 2026, US)", () => {
    // Walk twelve weeks through it: every step must stay on local midnight.
    let r = scheduleRangeFor("timeGridWeek", new Date(2026, 9, 1), 0);
    for (let i = 0; i < 12; i++) {
      const [next] = scheduleNeighbours(r, 0, [1]);
      expect(new Date(next.start).getHours()).toBe(0);
      expect(next).toEqual(scheduleRangeFor("timeGridWeek", new Date(next.start), 0));
      r = next;
    }
  });

  it("reads a month off any grid, even one starting in the month before", () => {
    // March 2026's grid starts on Sun 1 Mar; Feb 2026's starts on Sun 1 Feb;
    // Oct 2026's starts on Sun 27 Sep — the grid's first row isn't the month.
    const oct = scheduleRangeFor("dayGridMonth", new Date(2026, 9, 15), 0);
    expect(new Date(oct.start).getMonth()).toBe(8);
    const [nov, sep] = scheduleNeighbours(oct, 0, [1, -1]);
    expect(nov).toEqual(scheduleRangeFor("dayGridMonth", new Date(2026, 10, 1), 0));
    expect(sep).toEqual(scheduleRangeFor("dayGridMonth", new Date(2026, 8, 1), 0));
  });
});
