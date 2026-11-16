/**
 * A day is midnight to the NEXT midnight, not 24 hours. The day frame used
 * `dStart + 24h`, which on a 23-hour spring-forward Sunday reached 1am Monday —
 * so Monday's all-day event also showed on Sunday.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDayPlan, type DayCtx } from "../src/components/mobile/dayPlan";
import { parseDateISO } from "../src/lib/dates";
import type { ExternalEvent } from "../src/lib/types";

const realTZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = realTZ;
});

const allDay = (id: string, start_at: string, end_at: string) =>
  ({ id, title: id, all_day: true, busy: false, calendar_id: "c", start_at, end_at }) as ExternalEvent;

const ctx = (events: ExternalEvent[], now: Date): DayCtx => ({
  visibleEvents: events,
  blocks: [],
  slots: [],
  slotChildren: {},
  slotTitles: new Map(),
  hidden: new Set(),
  workStart: 480,
  workEnd: 990,
  now,
});

describe.each([
  // [zone, the 23-hour Sunday, the Monday after]
  ["America/Los_Angeles", "2026-03-08", "2026-03-09"],
  ["Europe/Paris", "2026-03-29", "2026-03-30"],
])("spring-forward in %s", (zone, sunday, monday) => {
  beforeAll(() => {
    process.env.TZ = zone;
  });

  it("does not show Monday's all-day event on the short Sunday", () => {
    const next = String(Number(monday.slice(8)) + 1).padStart(2, "0");
    // Google's shape (Pacific midnight) and the ICS / client shape (UTC midnight).
    const events = [
      allDay("google", `${monday}T08:00:00+00:00`, `${monday.slice(0, 8)}${next}T08:00:00+00:00`),
      allDay("ics", `${monday}T00:00:00+00:00`, `${monday.slice(0, 8)}${next}T00:00:00+00:00`),
    ];
    const c = ctx(events, parseDateISO(sunday));
    expect(buildDayPlan(parseDateISO(sunday), c).allDay.map((e) => e.id)).toEqual([]);
    expect(buildDayPlan(parseDateISO(monday), c).allDay.map((e) => e.id)).toEqual(["google", "ics"]);
  });
});
