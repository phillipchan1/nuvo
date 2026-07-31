import { describe, expect, it } from "vitest";
import {
  cadenceGroupKey,
  expandRule,
  groupSeriesByCadence,
  nextOccurrenceDate,
  parseRecurrencePhrase,
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
});
