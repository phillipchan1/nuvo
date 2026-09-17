// West of Greenwich is where a UTC-midnight row falls on the previous day.
// Node honours a runtime TZ change, and CI runs in UTC where the bug hides.
process.env.TZ = "America/Los_Angeles";

import { describe, expect, it, vi } from "vitest";
import { buildDayPlan, type DayCtx } from "../src/components/mobile/dayPlan";
import { allDayDates, parseDateISO } from "../src/lib/dates";
import { syncCalendarEvents, type CalendarBlockApi } from "../src/lib/syncCalendarEvents";
import type { ExternalEvent } from "../src/lib/types";

// The same all-day day (Thu 24 Sep 2026), as each provider stores it.
const ICS = { start_at: "2026-09-24T00:00:00+00:00", end_at: "2026-09-25T00:00:00+00:00" };
const GOOGLE = { start_at: "2026-09-24T08:00:00+00:00", end_at: "2026-09-25T08:00:00+00:00" };

describe("allDayDates", () => {
  it("reads the stored date, whatever instant the provider chose", () => {
    expect(allDayDates(ICS.start_at, ICS.end_at)).toEqual({ start: "2026-09-24", end: "2026-09-25" });
    expect(allDayDates(GOOGLE.start_at, GOOGLE.end_at)).toEqual({ start: "2026-09-24", end: "2026-09-25" });
  });

  it("keeps a span that doesn't end after it starts on its one day", () => {
    expect(allDayDates(ICS.start_at, ICS.start_at)).toEqual({ start: "2026-09-24", end: "2026-09-25" });
  });
});

describe("the phone's day plan", () => {
  const event = (id: string, row: typeof ICS) =>
    ({ id, title: id, all_day: true, busy: false, calendar_id: "c", ...row }) as ExternalEvent;
  const ctx = (): DayCtx => ({
    visibleEvents: [event("ics", ICS), event("google", GOOGLE)],
    blocks: [],
    slots: [],
    slotChildren: {},
    slotTitles: new Map(),
    hidden: new Set(),
    workStart: 480,
    workEnd: 990,
    now: new Date(2026, 8, 17, 10),
  });
  const onDay = (iso: string) => buildDayPlan(parseDateISO(iso), ctx()).allDay.map((e) => e.id);

  it("puts an all-day event on its day only", () => {
    expect(onDay("2026-09-23")).toEqual([]);
    expect(onDay("2026-09-24")).toEqual(["ics", "google"]);
    expect(onDay("2026-09-25")).toEqual([]);
  });
});

describe("the desktop grid reconcile", () => {
  it("leaves an unchanged all-day block alone", () => {
    // FullCalendar reads a date-only start as local midnight.
    const days = allDayDates(ICS.start_at, ICS.end_at);
    const existing = {
      id: "evt:1",
      title: "Focus Friday",
      start: parseDateISO(days.start),
      end: parseDateISO(days.end),
      allDay: true,
      classNames: [],
      backgroundColor: "",
      borderColor: "",
      textColor: "",
      display: "auto",
      extendedProps: {},
      setDates: vi.fn(),
      setProp: vi.fn(),
      setExtendedProp: vi.fn(),
      remove: vi.fn(),
    } satisfies CalendarBlockApi;
    const api = {
      getEvents: () => [existing],
      getEventById: () => existing,
      addEvent: vi.fn(),
    };
    const result = syncCalendarEvents(api, [{ id: "evt:1", title: "Focus Friday", allDay: true, ...days }]);
    // Every setDates re-measures the whole grid; a Month switch paid 38 per sync.
    expect(result.moved).toEqual([]);
    expect(existing.setDates).not.toHaveBeenCalled();
  });
});
