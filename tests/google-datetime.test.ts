// Google recurring masters store start/end either as an RFC3339 instant or as
// a naive civil clock plus timeZone. Shifting them with `new Date(civil)` is
// the local time of the runtime (UTC on Deno), which is how an ALL-scope drag
// used to PATCH the master to the wrong wall-clock — or get a 400 Google
// silently swallowed. These pin the civil-vs-instant split.

import { describe, expect, it } from "vitest";
import {
  shiftCivilDateTime,
  shiftGoogleDateResource,
} from "../supabase/functions/_shared/googleDateTime.ts";

describe("shiftCivilDateTime", () => {
  it("adds an hour to a naive civil clock without inventing an offset", () => {
    expect(shiftCivilDateTime("2026-08-04T09:00:00", 60 * 60 * 1000)).toBe("2026-08-04T10:00:00");
  });

  it("crosses midnight", () => {
    expect(shiftCivilDateTime("2026-08-04T23:30:00", 60 * 60 * 1000)).toBe("2026-08-05T00:30:00");
  });
});

describe("shiftGoogleDateResource", () => {
  it("shifts a civil clock + timeZone as wall-clock, not as UTC", () => {
    const next = shiftGoogleDateResource(
      { dateTime: "2026-08-04T09:00:00", timeZone: "America/Los_Angeles" },
      60 * 60 * 1000,
    );
    expect(next).toEqual({ dateTime: "2026-08-04T10:00:00", timeZone: "America/Los_Angeles" });
  });

  it("shifts an RFC3339 instant and keeps the zone", () => {
    const next = shiftGoogleDateResource(
      { dateTime: "2026-08-04T16:00:00-07:00", timeZone: "America/Los_Angeles" },
      60 * 60 * 1000,
    );
    expect(next?.dateTime).toBe("2026-08-05T00:00:00.000Z");
    expect(next?.timeZone).toBe("America/Los_Angeles");
  });

  it("shifts an all-day date by whole days", () => {
    expect(shiftGoogleDateResource({ date: "2026-08-04" }, 24 * 60 * 60 * 1000)).toEqual({
      date: "2026-08-05",
    });
  });

  it("is a no-op at delta 0", () => {
    const orig = { dateTime: "2026-08-04T09:00:00", timeZone: "America/Los_Angeles" };
    expect(shiftGoogleDateResource(orig, 0)).toEqual(orig);
  });
});
