import { describe, expect, it } from "vitest";
import {
  cadenceGroupKey,
  describeRule,
  expandRule,
  fromGoogleRRULE,
  groupSeriesByCadence,
  nextOccurrenceDate,
  parseRecurrencePhrase,
  setposOf,
  toGoogleRRULE,
  type RecurrenceRule,
} from "../supabase/functions/_shared/recurrence.ts";

describe("recurrence kernel", () => {
  it("expands every 5 months from anchor", () => {
    const dates = expandRule(
      { freq: "monthly", interval: 5 },
      "2026-07-31",
      "2026-07-31",
      "2027-12-31",
    );
    expect(dates[0]).toBe("2026-07-31");
    expect(dates[1]).toBe("2026-12-31");
    expect(dates[2]).toBe("2027-05-31");
  });

  it("finds next occurrence beyond materialization horizon", () => {
    const next = nextOccurrenceDate(
      { freq: "monthly", interval: 5 },
      "2026-07-31",
      "2026-08-01",
    );
    expect(next).toBe("2026-12-31");
  });

  it("parses every N months and starting today", () => {
    const { rule, anchorDate, stripped } = parseRecurrencePhrase(
      "regenerate Dayspring key every 5 months starting today",
      "2026-07-31",
    );
    expect(rule).toEqual({ freq: "monthly", interval: 5 });
    expect(anchorDate).toBe("2026-07-31");
    expect(stripped.toLowerCase()).toContain("dayspring");
    expect(stripped.toLowerCase()).not.toContain("every");
  });

  it("groups series by cadence", () => {
    const groups = groupSeriesByCadence(
      [
        {
          id: "a",
          title: "HVAC",
          anchor_date: "2026-01-15",
          exdates: [],
          freq: "monthly",
          interval: 6,
          byweekday: [],
          bymonthday: 15,
        },
        {
          id: "b",
          title: "Standup",
          anchor_date: "2026-07-28",
          exdates: [],
          freq: "weekly",
          interval: 1,
          byweekday: [2],
          bymonthday: null,
        },
      ],
      "2026-07-31",
    );
    expect(groups.map((g) => g.label)).toEqual(["Weekly", "Every 6 months"]);
    expect(groups[0]?.items[0]?.series.title).toBe("Standup");
  });

  it("cadenceGroupKey distinguishes long monthly intervals", () => {
    expect(cadenceGroupKey({ freq: "monthly", interval: 5 }).label).toBe("Every 5 months");
    expect(cadenceGroupKey({ freq: "monthly", interval: 1 }).label).toBe("Monthly");
  });

  it("round-trips Google RRULE lines", () => {
    const rule = { freq: "weekly" as const, interval: 2, byweekday: [1, 3] };
    const lines = toGoogleRRULE(rule);
    expect(fromGoogleRRULE(lines)).toEqual(rule);
  });

  it("parses RRULE with COUNT and UNTIL", () => {
    expect(fromGoogleRRULE(["RRULE:FREQ=DAILY;INTERVAL=1;COUNT=10"])).toEqual({
      freq: "daily",
      interval: 1,
      count: 10,
    });
    expect(fromGoogleRRULE(["RRULE:FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20261231T235959Z"])).toEqual({
      freq: "monthly",
      interval: 1,
      bymonthday: 15,
      until: "2026-12-31",
    });
  });
});

// ── The ceiling the 2026-08-12 audit found (rank 4) ──────────────────────────
//
// Before this, `freq` was daily|weekly|monthly-by-date and nothing else. Two
// whole classes of real commitment were UNREPRESENTABLE — annual ones, and
// positional ones ("the last Friday"), which is the shape most standing
// commitments take. And the gap cut both ways: an inbound Google series whose
// RRULE carried BYSETPOS lost the position on the way in, so an ALL-scope edit
// rewrote "the last Friday" as "every Friday" and moved the user's meeting.

describe("positional monthly rules", () => {
  const expand = (rule: RecurrenceRule, anchor: string, to: string) =>
    expandRule(rule, anchor, anchor, to);

  it("finds the last Friday of each month, not the fourth", () => {
    // August 2026 has FIVE Fridays (7, 14, 21, 28) — no: four. October 2026 has
    // five (2, 9, 16, 23, 30). A rule that quietly meant "the 4th" would land on
    // the 23rd there and drift a week, which is the whole reason -1 exists.
    const dates = expand(
      { freq: "monthly", interval: 1, byweekday: [5], bysetpos: -1 },
      "2026-08-01",
      "2026-11-01",
    );
    expect(dates).toEqual(["2026-08-28", "2026-09-25", "2026-10-30"]);
  });

  it("finds the second Tuesday", () => {
    const dates = expand(
      { freq: "monthly", interval: 1, byweekday: [2], bysetpos: 2 },
      "2026-08-01",
      "2026-11-01",
    );
    expect(dates).toEqual(["2026-08-11", "2026-09-08", "2026-10-13"]);
  });

  it("skips a month that has no fifth occurrence rather than spilling into the next", () => {
    const dates = expand(
      { freq: "monthly", interval: 1, byweekday: [5], bysetpos: 4 },
      "2026-08-01",
      "2026-10-01",
    );
    // Both months do have a 4th Friday; the point is that every emitted date is
    // inside its own month.
    for (const d of dates) expect(d.slice(8)).not.toBe("01");
  });

  it("skips a day-of-month that month can't hold, instead of rolling forward", () => {
    // The 31st: September and November simply don't have one.
    const dates = expand({ freq: "monthly", interval: 1, bymonthday: 31 }, "2026-08-31", "2026-12-01");
    expect(dates).toEqual(["2026-08-31", "2026-10-31"]);
  });
});

describe("yearly rules", () => {
  it("repeats on the anchor's month and day", () => {
    const dates = expandRule({ freq: "yearly", interval: 1 }, "2026-03-14", "2026-03-14", "2029-01-01");
    expect(dates).toEqual(["2026-03-14", "2027-03-14", "2028-03-14"]);
  });

  it("honours an interval", () => {
    const dates = expandRule({ freq: "yearly", interval: 2 }, "2026-03-14", "2026-03-14", "2031-01-01");
    expect(dates).toEqual(["2026-03-14", "2028-03-14", "2030-03-14"]);
  });

  it("can be positional too — the fourth Thursday of November", () => {
    const dates = expandRule(
      { freq: "yearly", interval: 1, bymonth: 11, byweekday: [4], bysetpos: 4 },
      "2026-11-26",
      "2026-01-01",
      "2029-01-01",
    );
    expect(dates).toEqual(["2026-11-26", "2027-11-25", "2028-11-23"]);
  });
});

describe("RRULE round-trip", () => {
  const round = (rule: RecurrenceRule) => fromGoogleRRULE(toGoogleRRULE(rule));

  it("keeps a positional monthly rule intact", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, byweekday: [5], bysetpos: -1 };
    expect(toGoogleRRULE(rule)[0]).toBe("RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1");
    expect(round(rule)).toMatchObject({ freq: "monthly", bysetpos: -1, byweekday: [5] });
  });

  it("keeps a yearly rule intact", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 1, bymonth: 3, bymonthday: 14 };
    expect(round(rule)).toMatchObject({ freq: "yearly", bymonth: 3, bymonthday: 14 });
  });

  it("reads the BYDAY=-1FR shorthand other clients emit", () => {
    // This is the lossy path the audit named: read as a plain BYDAY it becomes
    // "every Friday", and an ALL-scope edit then moves the whole series.
    const rule = fromGoogleRRULE(["RRULE:FREQ=MONTHLY;BYDAY=-1FR"]);
    expect(rule).toMatchObject({ freq: "monthly", bysetpos: -1, byweekday: [5] });
  });

  it("no longer drops a yearly series on the way in", () => {
    expect(fromGoogleRRULE(["RRULE:FREQ=YEARLY"])).toMatchObject({ freq: "yearly" });
  });
});

describe("describing the new shapes in words", () => {
  it("says what a positional rule actually does", () => {
    expect(describeRule({ freq: "monthly", interval: 1, byweekday: [5], bysetpos: -1 })).toBe(
      "Monthly on the last Friday",
    );
    expect(describeRule({ freq: "monthly", interval: 1, byweekday: [2], bysetpos: 2 })).toBe(
      "Monthly on the second Tuesday",
    );
  });

  it("names the month for a yearly rule", () => {
    expect(describeRule({ freq: "yearly", interval: 1 }, "2026-03-14")).toBe("Every year on March 14");
  });
});

describe("setposOf — which occurrence the anchor is", () => {
  it("prefers 'last' when the anchor is the final one of its weekday", () => {
    // 2026-08-28 is both the 4th Friday and the last one. Offering "fourth"
    // would drift in five-Friday months, so the honest read is "last".
    expect(setposOf("2026-08-28")).toBe(-1);
  });

  it("counts forward otherwise", () => {
    expect(setposOf("2026-08-11")).toBe(2);
    expect(setposOf("2026-08-04")).toBe(1);
  });
});
