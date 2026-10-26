import { describe, expect, it } from "vitest";
import { fromGoogleRRULE, shiftRRuleDays, toGoogleRRULE } from "../supabase/functions/_shared/recurrence.ts";

const LA = "America/Los_Angeles";

describe("an event series' end date is that zone's day", () => {
  it("ends at the last instant of the local day", () => {
    const [line] = toGoogleRRULE({ freq: "weekly", interval: 1, byweekday: [3], until: "2026-12-16" }, { tz: LA });
    // Dec 16 23:59:59 PST = Dec 17 07:59:59Z — a 6pm final occurrence (02:00Z) is inside.
    expect(line).toContain("UNTIL=20261217T075959Z");
  });

  it("reads Google's own UNTIL back as the same local day", () => {
    const rule = fromGoogleRRULE(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261217T075959Z"], { tz: LA });
    expect(rule?.until).toBe("2026-12-16");
    // Round-trips without growing a day.
    expect(toGoogleRRULE(rule!, { tz: LA })[0]).toContain("UNTIL=20261217T075959Z");
  });

  it("an all-day series ends on a DATE", () => {
    const [line] = toGoogleRRULE({ freq: "weekly", interval: 1, byweekday: [3], until: "2026-12-16" }, { allDay: true });
    expect(line).toContain("UNTIL=20261216");
    expect(line).not.toContain("UNTIL=20261216T");
    expect(fromGoogleRRULE([line])?.until).toBe("2026-12-16");
  });

  it("without a zone keeps the old UTC-day reading (tasks)", () => {
    const [line] = toGoogleRRULE({ freq: "daily", interval: 1, until: "2026-12-16" });
    expect(line).toContain("UNTIL=20261216T235959Z");
  });
});

describe("shiftRRuleDays", () => {
  it("moves weekly days with the series", () => {
    expect(shiftRRuleDays(["RRULE:FREQ=WEEKLY;BYDAY=WE"], 1)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
    expect(shiftRRuleDays(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"], -1)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=SU,TU,TH"]);
    expect(shiftRRuleDays(["RRULE:FREQ=WEEKLY;BYDAY=SA"], 1)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=SU"]);
  });
  it("keeps an ordinal and moves the month day", () => {
    expect(shiftRRuleDays(["RRULE:FREQ=MONTHLY;BYDAY=-1FR"], 1)).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=-1SA"]);
    expect(shiftRRuleDays(["RRULE:FREQ=MONTHLY;BYMONTHDAY=15"], 2)).toEqual(["RRULE:FREQ=MONTHLY;BYMONTHDAY=17"]);
  });
  it("leaves other lines and a zero move alone", () => {
    expect(shiftRRuleDays(["EXDATE:20261028T010000Z"], 3)).toEqual(["EXDATE:20261028T010000Z"]);
    expect(shiftRRuleDays(["RRULE:FREQ=WEEKLY;BYDAY=WE"], 0)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE"]);
  });
});
