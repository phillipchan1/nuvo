// The day's shared kernel. These pin the rules that a watch (which cannot
// import a line of `src/`) will render without re-deriving, and the one
// distinction that used to be a silent disagreement between the app and the
// agent: "gaps between commitments" is NOT "room left in the day".

import { describe, expect, it } from "vitest";
import {
  LOAD_BANDS,
  buildDaySchedule,
  busyIntervalsFor,
  computeOpenWindows,
  dayLoad,
  dayReadout,
  fmtEvent,
  fmtTask,
  loadLabel,
  longestClearRun,
  makeEventVisibility,
  openMinutes,
  openSpans,
  spanLoad,
  visibleEventRows,
  zonedInstant,
} from "../supabase/functions/_shared/dayShape.ts";

const TZ = "America/Los_Angeles";
const DATE = "2026-08-14"; // a Friday, PDT (UTC-7)

/** 8:00 local on DATE, as a UTC ISO string. */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(zonedInstant(DATE, h * 60 + m, TZ)).toISOString();
};

const evt = (title: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
  fmtEvent(
    {
      id: title,
      title,
      start_at: at(start),
      end_at: at(end),
      all_day: false,
      calendar_id: "cal-1",
      account_id: "acct-1",
      provider_event_id: `pid-${title}`,
      ...extra,
    },
    DATE,
    zonedInstant(DATE, 9 * 60, TZ),
    TZ,
  );

describe("zonedInstant — the server has no local zone of its own", () => {
  it("resolves a wall-clock time on a local date in the given zone", () => {
    // 08:00 PDT (UTC-7) is 15:00 UTC.
    expect(new Date(zonedInstant("2026-08-14", 480, TZ)).toISOString()).toBe(
      "2026-08-14T15:00:00.000Z",
    );
  });

  it("follows the zone across a DST boundary rather than assuming one offset", () => {
    // Mid-January is PST (UTC-8), so the same 08:00 is an hour later in UTC.
    expect(new Date(zonedInstant("2026-01-14", 480, TZ)).toISOString()).toBe(
      "2026-01-14T16:00:00.000Z",
    );
  });

  it("is zone-relative, not server-relative", () => {
    const la = zonedInstant("2026-08-14", 480, "America/Los_Angeles");
    const nyc = zonedInstant("2026-08-14", 480, "America/New_York");
    // 08:00 in New York happens three hours before 08:00 in Los Angeles.
    expect(la - nyc).toBe(3 * 3_600_000);
  });

  it("rejects a malformed date instead of inventing one", () => {
    expect(Number.isNaN(zonedInstant("14-08-2026", 480, TZ))).toBe(true);
  });
});

describe("the two open-time questions are different, on purpose", () => {
  const workStart = zonedInstant(DATE, 480, TZ); // 08:00
  const workEnd = zonedInstant(DATE, 990, TZ); // 16:30

  it("a single meeting leaves the day mostly open, but leaves NO gap between commitments", () => {
    const events = [evt("standup", "10:00", "10:30")];
    const busy = busyIntervalsFor(events, [], [], DATE);

    // "What fits between two meetings?" — there is no between.
    expect(computeOpenWindows(events, [], [], DATE, workStart, TZ)).toEqual([]);

    // "How much room does this day have?" — 8h30m of window minus 30m.
    const mins = openMinutes(openSpans(busy, workStart, workEnd, workStart));
    expect(mins).toBe(510 - 30);
  });

  it("finds the gap between two commitments", () => {
    const events = [evt("standup", "10:00", "10:30"), evt("review", "13:00", "14:00")];
    const windows = computeOpenWindows(events, [], [], DATE, workStart, TZ);
    expect(windows).toHaveLength(1);
    expect(windows[0].minutes).toBe(150);
  });

  it("counts a held slot as busy — the point of holding one", () => {
    const slot = {
      id: "s1",
      title: "Deep work",
      timeRange: "9:00 AM–11:00 AM",
      startISO: at("09:00"),
      durationMinutes: 120,
      localDate: DATE,
      past: false,
      projectId: null,
      domainId: null,
      tasks: [],
    };
    const mins = openMinutes(
      openSpans(busyIntervalsFor([], [], [slot], DATE), workStart, workEnd, workStart),
    );
    expect(mins).toBe(510 - 120);
  });

  it("ignores an all-day event — it marks the day, it doesn't block 9am", () => {
    const allDay = fmtEvent(
      {
        id: "conf",
        title: "Conference",
        start_at: at("00:00"),
        end_at: at("23:59"),
        all_day: true,
        calendar_id: "cal-1",
        account_id: "acct-1",
        provider_event_id: "pid-conf",
      },
      DATE,
      workStart,
      TZ,
    );
    expect(busyIntervalsFor([allDay], [], [], DATE)).toEqual([]);
  });

  it("ignores an event the provider marks free — a PTO block is not your meeting", () => {
    const free = evt("Anelis PTO", "09:00", "17:00", { busy: false });
    expect(busyIntervalsFor([free], [], [], DATE)).toEqual([]);
    // …but it still shows on the day, flagged, so a client can render it.
    const items = buildDaySchedule([free], [], [], DATE);
    expect(items).toHaveLength(1);
    expect(items[0].busy).toBe(false);
  });

  it("treats a missing busy column as busy rather than transparent", () => {
    // A caller whose query omits `busy` must not have its calendar vanish.
    const noColumn = evt("standup", "10:00", "10:30");
    expect(busyIntervalsFor([noColumn], [], [], DATE)).toHaveLength(1);
  });

  it("does not offer time that has already passed", () => {
    const busy = busyIntervalsFor([evt("standup", "10:00", "10:30")], [], [], DATE);
    const atNoon = zonedInstant(DATE, 12 * 60, TZ);
    // From noon, only 12:00→16:30 remains.
    expect(openMinutes(openSpans(busy, workStart, workEnd, atNoon))).toBe(270);
  });

  it("starts the next span after the meeting you are currently in", () => {
    const busy = busyIntervalsFor([evt("standup", "10:00", "11:00")], [], [], DATE);
    const midMeeting = zonedInstant(DATE, 10 * 60 + 15, TZ);
    const spans = openSpans(busy, workStart, workEnd, midMeeting);
    expect(spans).toHaveLength(1);
    expect(new Date(spans[0].startMs).toISOString()).toBe(at("11:00"));
  });
});

describe("visibility — hidden is out of the ledger", () => {
  const rows = [
    { id: "1", title: "A", start_at: at("09:00"), calendar_id: "cal-1", account_id: "a", provider_event_id: "p1" },
    { id: "2", title: "B", start_at: at("10:00"), calendar_id: "hidden-cal", account_id: "a", provider_event_id: "p2" },
    { id: "3", title: "C", start_at: at("11:00"), calendar_id: "cal-1", account_id: "a", provider_event_id: "p3" },
  ];

  it("drops events on a hidden calendar", () => {
    const vis = makeEventVisibility({ hidden_calendar_ids: ["hidden-cal"], hidden_events: [] });
    expect(visibleEventRows(rows, vis).map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("drops an individually hidden event by its stable key", () => {
    const vis = makeEventVisibility({ hidden_calendar_ids: [], hidden_events: [{ key: "a:p3" }] });
    expect(visibleEventRows(rows, vis).map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("hides a whole series through the series key", () => {
    const series = [
      { id: "s1", title: "Standup", start_at: at("09:00"), calendar_id: "cal-1", account_id: "a", provider_event_id: "i1", recurring_event_id: "r1" },
      { id: "s2", title: "Standup", start_at: at("09:00"), calendar_id: "cal-1", account_id: "a", provider_event_id: "i2", recurring_event_id: "r1" },
    ];
    const vis = makeEventVisibility({ hidden_calendar_ids: [], hidden_events: [{ key: "a:series:r1" }] });
    expect(visibleEventRows(series, vis)).toEqual([]);
  });

  it("de-duplicates the same event synced through two accounts", () => {
    const dupes = [
      { id: "1", title: "Sync", start_at: at("09:00"), calendar_id: "cal-1", account_id: "a", provider_event_id: "same" },
      { id: "2", title: "Sync", start_at: at("09:00"), calendar_id: "cal-2", account_id: "b", provider_event_id: "same" },
    ];
    const vis = makeEventVisibility(null);
    expect(visibleEventRows(dupes, vis)).toHaveLength(1);
  });
});

describe("buildDaySchedule", () => {
  it("orders events, blocks and slots together by clock time", () => {
    const events = [evt("late", "15:00", "16:00"), evt("early", "09:00", "09:30")];
    const task = fmtTask(
      { id: "t1", title: "Write", status: "planned", start_time: at("11:00"), duration_minutes: 60 },
      DATE,
      zonedInstant(DATE, 9 * 60, TZ),
      TZ,
    );
    const items = buildDaySchedule(events, [task], [], DATE);
    expect(items.map((i) => i.title)).toEqual(["early", "Write", "late"]);
    expect(items.map((i) => i.kind)).toEqual(["event", "task", "event"]);
  });

  it("leaves out anything belonging to another date", () => {
    expect(buildDaySchedule([evt("today", "09:00", "10:00")], [], [], "2026-08-15")).toEqual([]);
  });

  // Regression: the sort read AM/PM from the whole "11:00 AM–12:00 PM" string,
  // so the end time's meridiem won and a late-morning item sorted as 11pm —
  // last in the day the agent was shown.
  it("sorts a morning item that ends after noon by its START time", () => {
    const items = buildDaySchedule(
      [evt("afternoon", "14:00", "15:00"), evt("crosses noon", "11:00", "12:30")],
      [],
      [],
      DATE,
    );
    expect(items.map((i) => i.title)).toEqual(["crosses noon", "afternoon"]);
  });

  it("puts an all-day event first rather than at a parsed midnight", () => {
    const allDay = fmtEvent(
      {
        id: "c",
        title: "Conference",
        start_at: at("00:00"),
        end_at: at("23:59"),
        all_day: true,
        calendar_id: "cal-1",
        account_id: "a",
        provider_event_id: "pc",
      },
      DATE,
      zonedInstant(DATE, 9 * 60, TZ),
      TZ,
    );
    const items = buildDaySchedule([allDay, evt("standup", "09:00", "09:30")], [], [], DATE);
    expect(items[0].title).toBe("Conference");
    expect(items[0].timeRange).toBe("all day");
  });
});

describe("dayReadout — one set of words for every surface", () => {
  it("names the room left on a live day", () => {
    expect(dayReadout({ busyCount: 2, openMins: 200, isPast: false, isBygone: false })).toEqual({
      text: "3h 20m open",
      accent: true,
    });
  });

  it("says fully booked rather than 0m open", () => {
    expect(dayReadout({ busyCount: 4, openMins: 0, isPast: false, isBygone: false }).text).toBe(
      "fully booked",
    );
  });

  it("distinguishes an empty day from a full one", () => {
    expect(dayReadout({ busyCount: 0, openMins: 0, isPast: false, isBygone: false }).text).toBe(
      "wide open",
    );
  });

  it("stops advertising open time once the working day has ended", () => {
    const r = dayReadout({ busyCount: 3, openMins: 120, isPast: true, isBygone: false });
    expect(r.text).toBe("done for today");
    expect(r.accent).toBe(false);
  });

  it("reads a past day as a record, never as availability", () => {
    const r = dayReadout({ busyCount: 5, openMins: 300, isPast: false, isBygone: true });
    expect(r.text).toBe("5 scheduled");
    expect(r.accent).toBe(false);
  });
});

// ── the load bands — the rule a year grid is shaded by ──────────────────────
// A year of squares is only worth a place if the shading is TRUE, so these pin
// the four ways it could quietly lie: double-counting a double-booking,
// erasing an evening, calling an all-day commitment "nothing on", and treating
// forty scattered free Tuesdays as somewhere a week of work fits.

describe("dayLoad", () => {
  const WINDOW_START = zonedInstant(DATE, 8 * 60, TZ); // 08:00
  const WINDOW_END = zonedInstant(DATE, 16 * 60 + 30, TZ); // 16:30 → 510m
  const span = (from: string, to: string) => ({
    startMs: new Date(at(from)).getTime(),
    endMs: new Date(at(to)).getTime(),
  });
  const load = (busy: Array<{ startMs: number; endMs: number }>, count = busy.length) =>
    dayLoad(busy, WINDOW_START, WINDOW_END, count);

  it("calls an empty day clear", () => {
    const l = load([]);
    expect(l.band).toBe("clear");
    expect(l.level).toBe(0);
    expect(l.claimedMins).toBe(0);
  });

  it("never calls a day with an all-day commitment clear", () => {
    // Zero timed minutes, one commitment. An all-day "Conference" does not
    // block 9am specifically — but the day is spoken for, and a grid that
    // paints it blank is telling you it is free.
    const l = dayLoad([], WINDOW_START, WINDOW_END, 1);
    expect(l.band).toBe("light");
    expect(l.count).toBe(1);
  });

  it("counts two meetings booked on top of each other once", () => {
    // 9–11 and 10–12 is three claimed hours, not four. Summing durations would
    // read a double-booked morning as a full day.
    const l = load([span("09:00", "11:00"), span("10:00", "12:00")]);
    expect(l.claimedMins).toBe(180);
  });

  it("counts a commitment outside working hours", () => {
    // A 7pm dinner is not free time because it falls after 16:30. The window is
    // the yardstick, never a filter.
    const l = load([span("19:00", "21:00")]);
    expect(l.claimedMins).toBe(120);
    expect(l.band).toBe("light");
  });

  it("climbs light → busy → full as the day fills", () => {
    expect(load([span("09:00", "10:00")]).band).toBe("light"); // 60/510
    expect(load([span("09:00", "12:00")]).band).toBe("busy"); // 180/510
    expect(load([span("09:00", "16:00")]).band).toBe("full"); // 420/510
  });

  it("calls a day promised more than it holds overcommitted", () => {
    const l = load([span("07:00", "19:00")]); // 12h against an 8.5h window
    expect(l.band).toBe("over");
    expect(l.ratio).toBeGreaterThan(1);
    expect(LOAD_BANDS.indexOf(l.band)).toBe(l.level);
  });

  it("gives every band a word — colour is never the whole answer", () => {
    for (const b of LOAD_BANDS) expect(loadLabel(b)).toBeTruthy();
  });
});

describe("spanLoad + longestClearRun", () => {
  const WINDOW_START = zonedInstant(DATE, 8 * 60, TZ);
  const WINDOW_END = zonedInstant(DATE, 16 * 60 + 30, TZ);
  const clear = () => dayLoad([], WINDOW_START, WINDOW_END, 0);
  const heavy = () =>
    dayLoad(
      [{ startMs: WINDOW_START, endMs: WINDOW_END }],
      WINDOW_START,
      WINDOW_END,
      1,
    );

  it("rolls a run of days into one comparable read", () => {
    const s = spanLoad([clear(), clear(), heavy(), heavy()]);
    expect(s.days).toBe(4);
    expect(s.clearDays).toBe(2);
    expect(s.heavyDays).toBe(2);
  });

  it("reads a month with nothing in it as clear, not as light", () => {
    expect(spanLoad([clear(), clear(), clear()]).band).toBe("clear");
  });

  it("finds the longest unbroken clear stretch, not the count", () => {
    // Scattered singles and one real fortnight score the same on a count, and
    // only one of them is somewhere a week of work fits.
    const days = [clear(), heavy(), clear(), heavy(), clear(), clear(), clear(), heavy()];
    const run = longestClearRun(days);
    expect(run.startIndex).toBe(4);
    expect(run.length).toBe(3);
  });

  it("reports no run at all when every day is spoken for", () => {
    expect(longestClearRun([heavy(), heavy()])).toEqual({ startIndex: 0, length: 0 });
  });
});
