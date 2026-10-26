import { describe, expect, it } from "vitest";
import {
  addExdate,
  buildEvent,
  patchMaster,
  setPartstat,
  shiftMaster,
  upsertOverride,
} from "../supabase/functions/_shared/icalwrite.ts";
import { buildVtimezone, localIcalToMs, toIcalLocal } from "../supabase/functions/_shared/icalTz.ts";
import { parseIcs } from "../supabase/functions/_shared/ics.ts";

// The bug this file exists for: "every Wednesday 6–7pm" on an Apple calendar,
// made in Pasadena, was written as DTSTART:20261029T010000Z + BYDAY=WE. RFC 5545
// expands BYDAY in DTSTART's zone, so the series landed on Tuesday at 5pm.

const LA = "America/Los_Angeles";
const SOCCER_START = "2026-10-29T01:00:00.000Z"; // Wed Oct 28, 6pm PDT
const SOCCER_END = "2026-10-29T02:00:00.000Z";

function expand(ics: string, from = "2026-10-01", to = "2026-12-31") {
  return parseIcs(ics, {
    userId: "u",
    accountId: "a",
    windowStart: new Date(from),
    windowEnd: new Date(to),
    runStamp: "now",
  }).rows;
}

/** "Wed 18:00" in Pacific — what the user would read on the calendar. */
function local(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleString("en-US", { timeZone: LA, weekday: "short" });
  const time = d.toLocaleString("en-US", { timeZone: LA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day} ${time}`;
}

describe("a weekly Apple series repeats on the local weekday, across DST", () => {
  it("creates every Wednesday 6pm, including after the clocks change", () => {
    const ics = buildEvent({
      uid: "soccer",
      title: "Kids' soccer",
      startISO: SOCCER_START,
      endISO: SOCCER_END,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      timeZone: LA,
    });
    expect(ics).toContain(`DTSTART;TZID=${LA}:20261028T180000`);
    expect(ics).toContain("BEGIN:VTIMEZONE");
    const rows = expand(ics);
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(new Set(rows.map((r) => local(r.start_at)))).toEqual(new Set(["Wed 18:00"]));
    expect(local(rows[0].start_at)).toBe("Wed 18:00");
    expect(rows[0].start_at).toBe(SOCCER_START);
    // Nov 4 is after DST ended — still 6pm local, now 02:00Z.
    expect(rows.some((r) => r.start_at === "2026-11-05T02:00:00.000Z")).toBe(true);
  });

  it("a lone event without a zone is still written in UTC", () => {
    const ics = buildEvent({ uid: "x", title: "x", startISO: SOCCER_START, endISO: SOCCER_END });
    expect(ics).toContain("DTSTART:20261029T010000Z");
    expect(ics).not.toContain("VTIMEZONE");
  });

  it("turning a single UTC event weekly anchors it to the editor's zone", () => {
    const single = buildEvent({ uid: "s", title: "Soccer", startISO: SOCCER_START, endISO: SOCCER_END });
    const next = patchMaster(single, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"], timeZone: LA });
    expect(next).toContain(`DTSTART;TZID=${LA}:20261028T180000`);
    expect(next).toContain(`DTEND;TZID=${LA}:20261028T190000`);
    const rows = expand(next);
    expect(new Set(rows.map((r) => local(r.start_at)))).toEqual(new Set(["Wed 18:00"]));
  });

  it("re-applying the rule repairs a series Nuvo already wrote in UTC", () => {
    const broken = buildEvent({
      uid: "soccer",
      title: "Kids' soccer",
      startISO: SOCCER_START,
      endISO: SOCCER_END,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    });
    expect(new Set(expand(broken).map((r) => local(r.start_at)))).not.toEqual(new Set(["Wed 18:00"]));
    const fixed = patchMaster(broken, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"], timeZone: LA });
    expect(new Set(expand(fixed).map((r) => local(r.start_at)))).toEqual(new Set(["Wed 18:00"]));
  });

  it("removing the rule leaves one event", () => {
    const series = buildEvent({
      uid: "s",
      title: "S",
      startISO: SOCCER_START,
      endISO: SOCCER_END,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      timeZone: LA,
    });
    const rows = expand(patchMaster(series, { recurrence: null, timeZone: LA }));
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_event_id).toBe("s");
  });

  it("changing weekly → Mon/Wed keeps the time", () => {
    const series = buildEvent({
      uid: "s",
      title: "S",
      startISO: SOCCER_START,
      endISO: SOCCER_END,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      timeZone: LA,
    });
    const rows = expand(patchMaster(series, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], timeZone: LA }));
    expect(new Set(rows.map((r) => local(r.start_at)))).toEqual(new Set(["Mon 18:00", "Wed 18:00"]));
  });

  it("moving the whole series an hour keeps it on Wednesdays", () => {
    const broken = buildEvent({
      uid: "s",
      title: "S",
      startISO: SOCCER_START,
      endISO: SOCCER_END,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    });
    const moved = shiftMaster(broken, 60 * 60_000, undefined, 60 * 60_000, LA);
    expect(new Set(expand(moved).map((r) => local(r.start_at)))).toEqual(new Set(["Wed 19:00"]));
  });
});

// Apple Calendar's own series — the shape every native recurring event has.
const NATIVE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//iPhone OS 18//EN",
  buildVtimezone(LA, "2026-09-01T00:00:00Z"),
  "BEGIN:VEVENT",
  "UID:staff",
  "DTSTAMP:20260901T000000Z",
  `DTSTART;TZID=${LA}:20260914T123000`,
  `DTEND;TZID=${LA}:20260914T150000`,
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "SUMMARY:Frontier staff meeting",
  "ATTENDEE;CN=Phil;PARTSTAT=NEEDS-ACTION:mailto:phil@example.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("one occurrence of a TZID series (the row's RECURRENCE-ID suffix)", () => {
  const rows = expand(NATIVE, "2026-09-01", "2026-11-30");
  const target = rows.find((r) => local(r.start_at) === "Mon 12:30" && r.start_at.startsWith("2026-11-09"))!;
  const suffix = target.provider_event_id.split("::")[1];

  it("the suffix is a wall clock, not UTC", () => {
    expect(suffix).toBe("20261109T123000");
  });

  it("delete THIS removes exactly that Monday", () => {
    const next = addExdate(NATIVE, suffix);
    expect(next).toContain(`EXDATE;TZID=${LA}:20261109T123000`);
    const after = expand(next, "2026-09-01", "2026-11-30");
    expect(after).toHaveLength(rows.length - 1);
    expect(after.some((r) => r.provider_event_id === target.provider_event_id)).toBe(false);
  });

  it("an ISO instant resolves to the same occurrence", () => {
    const next = addExdate(NATIVE, target.start_at);
    expect(next).toContain(`EXDATE;TZID=${LA}:20261109T123000`);
  });

  it("edit THIS moves only that Monday, and editing it again replaces the override", () => {
    const moved = upsertOverride(NATIVE, suffix, {
      startISO: "2026-11-09T21:00:00.000Z",
      endISO: "2026-11-09T22:00:00.000Z",
    });
    expect(moved).toContain(`RECURRENCE-ID;TZID=${LA}:20261109T123000`);
    const after = expand(moved, "2026-09-01", "2026-11-30");
    expect(after).toHaveLength(rows.length);
    const nov9 = after.filter((r) => r.start_at.startsWith("2026-11-09"));
    expect(nov9).toHaveLength(1);
    expect(nov9[0].start_at).toBe("2026-11-09T21:00:00.000Z");
    expect(nov9[0].title).toBe("Frontier staff meeting");

    const retitled = upsertOverride(moved, suffix, { title: "Staff (offsite)" });
    expect(retitled.match(/RECURRENCE-ID/g)).toHaveLength(1);
    const again = expand(retitled, "2026-09-01", "2026-11-30").filter((r) => r.start_at.startsWith("2026-11-09"));
    // A retitle keeps the moved time, and a move kept the title.
    expect(again).toEqual([expect.objectContaining({ title: "Staff (offsite)", start_at: "2026-11-09T21:00:00.000Z" })]);
  });

  it("deleting an occurrence that was edited drops its override too", () => {
    const moved = upsertOverride(NATIVE, suffix, { title: "Moved" });
    const gone = expand(addExdate(moved, suffix), "2026-09-01", "2026-11-30");
    expect(gone.some((r) => r.start_at.startsWith("2026-11-09"))).toBe(false);
  });

  it("RSVP to one occurrence clones it at its own time", () => {
    const next = setPartstat(NATIVE, "phil@example.com", "ACCEPTED", suffix);
    const after = expand(next, "2026-09-01", "2026-11-30");
    expect(after).toHaveLength(rows.length);
    expect(next).toContain(`RECURRENCE-ID;TZID=${LA}:20261109T123000`);
    expect(next).toContain(`DTSTART;TZID=${LA}:20261109T123000`);
  });

  it("changing the rule keeps the series' TZID", () => {
    const next = patchMaster(NATIVE, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"], timeZone: "Asia/Tokyo" });
    expect(next).toContain(`DTSTART;TZID=${LA}:20260914T123000`);
    expect(next).not.toContain("Asia/Tokyo");
  });
});

describe("all-day series", () => {
  it("deletes one day by its DATE suffix", () => {
    const ics = buildEvent({
      uid: "trash",
      title: "Trash night",
      startISO: "2026-10-28T00:00:00.000Z",
      endISO: "2026-10-29T00:00:00.000Z",
      allDay: true,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      timeZone: LA,
    });
    const rows = expand(ics);
    const target = rows[1];
    const suffix = target.provider_event_id.split("::")[1];
    expect(suffix).toMatch(/^\d{8}$/);
    const after = expand(addExdate(ics, suffix));
    expect(after).toHaveLength(rows.length - 1);
  });
});

describe("icalTz", () => {
  it("round-trips a wall clock through the zone, both sides of DST", () => {
    expect(toIcalLocal("2026-07-01T19:00:00.000Z", LA)).toBe("20260701T120000");
    expect(toIcalLocal("2026-12-01T20:00:00.000Z", LA)).toBe("20261201T120000");
    expect(new Date(localIcalToMs("20260701T120000", LA)).toISOString()).toBe("2026-07-01T19:00:00.000Z");
    expect(new Date(localIcalToMs("20261201T120000", LA)).toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });

  it("describes a zone without DST", () => {
    const vt = buildVtimezone("Asia/Tokyo", "2026-10-01T00:00:00Z");
    expect(vt).toContain("TZOFFSETTO:+0900");
    const ics = buildEvent({
      uid: "t",
      title: "T",
      startISO: "2026-10-28T09:00:00.000Z",
      endISO: "2026-10-28T10:00:00.000Z",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      timeZone: "Asia/Tokyo",
    });
    const rows = expand(ics);
    expect(rows.every((r) => r.start_at.endsWith("T09:00:00.000Z"))).toBe(true);
  });

  it("works for a southern-hemisphere zone", () => {
    const ics = buildEvent({
      uid: "syd",
      title: "Syd",
      startISO: "2026-03-30T22:00:00.000Z", // Tue 9am AEDT
      endISO: "2026-03-30T23:00:00.000Z",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
      timeZone: "Australia/Sydney",
    });
    const rows = expand(ics, "2026-03-25", "2026-04-30");
    const hours = rows.map((r) =>
      new Date(r.start_at).toLocaleString("en-US", { timeZone: "Australia/Sydney", weekday: "short", hour: "2-digit", hourCycle: "h23" }),
    );
    expect(new Set(hours.map((h) => h.replace(",", "")))).toEqual(new Set(["Tue 09"]));
  });
});

// ── The id an open sheet holds must survive a series-level write ───────────
import { db, resetDb } from "./agent/fakeSupabase.ts";
import { materializeIcloudResource } from "../supabase/functions/_shared/icloudExpand.ts";

describe("materializeIcloudResource", () => {
  const target = {
    userId: "u1",
    accountId: "acct",
    accountEmail: "me@icloud.com",
    calendarId: "https://caldav/family/",
    uid: "nuvo-1",
    href: "https://caldav/family/nuvo-1.ics",
    etag: "e2",
  };
  // Inside the sync window whenever the suite runs.
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setUTCHours(1, 0, 0, 0);
  const startISO = start.toISOString();
  const endISO = new Date(start.getTime() + 3_600_000).toISOString();

  it("turning the open single event weekly keeps its id and adds every occurrence", async () => {
    resetDb({
      external_events: [
        { id: "open-row", user_id: "u1", account_id: "acct", calendar_id: target.calendarId, provider_event_id: "nuvo-1", start_at: startISO, end_at: endISO, title: "Soccer" },
        { id: "other", user_id: "u1", account_id: "acct", calendar_id: target.calendarId, provider_event_id: "someone-else", start_at: startISO, end_at: endISO, title: "Other" },
      ],
    });
    const single = buildEvent({ uid: "nuvo-1", title: "Soccer", startISO, endISO });
    const weekly = patchMaster(single, { recurrence: ["RRULE:FREQ=WEEKLY"], timeZone: LA });
    const kept = await materializeIcloudResource(target, weekly, { rowId: "open-row", anchorMs: start.getTime() });

    expect(kept?.id).toBe("open-row");
    const rows = db.external_events.filter((r) => String(r.provider_event_id).startsWith("nuvo-1"));
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.every((r) => String(r.provider_event_id).startsWith("nuvo-1::"))).toBe(true);
    const open = db.external_events.find((r) => r.id === "open-row")!;
    expect(open.start_at).toBe(startISO);
    expect((open.raw as { caldav_href: string }).caldav_href).toBe(target.href);
    // Other events are untouched.
    expect(db.external_events.some((r) => r.id === "other")).toBe(true);
  });

  it("removing the rule collapses the series onto the open row", async () => {
    const weekly = buildEvent({ uid: "nuvo-1", title: "Soccer", startISO, endISO, recurrence: ["RRULE:FREQ=WEEKLY"], timeZone: LA });
    resetDb({ external_events: [] });
    await materializeIcloudResource(target, weekly, { anchorMs: start.getTime() });
    const second = db.external_events[1];
    second.id = "open-row";
    const single = patchMaster(weekly, { recurrence: null });
    const kept = await materializeIcloudResource(target, single, { rowId: "open-row", anchorMs: new Date(String(second.start_at)).getTime() });
    expect(kept?.id).toBe("open-row");
    expect(db.external_events).toHaveLength(1);
    expect(db.external_events[0].provider_event_id).toBe("nuvo-1");
  });

  it("a create returns the first occurrence's row", async () => {
    resetDb({ external_events: [] });
    const weekly = buildEvent({ uid: "nuvo-1", title: "Soccer", startISO, endISO, recurrence: ["RRULE:FREQ=WEEKLY"], timeZone: LA });
    const row = await materializeIcloudResource(target, weekly, { anchorMs: start.getTime() });
    expect(row?.start_at).toBe(startISO);
    expect(String(row?.provider_event_id)).toMatch(/^nuvo-1::/);
  });
});

describe("moving a whole Apple series to another day", () => {
  const series = buildEvent({
    uid: "s",
    title: "Soccer",
    startISO: SOCCER_START,
    endISO: SOCCER_END,
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    timeZone: LA,
  });

  it("Wednesday → Thursday moves BYDAY too", () => {
    const moved = shiftMaster(series, 86_400_000, undefined, 86_400_000, LA);
    expect(moved).toContain("BYDAY=TH");
    expect(new Set(expand(moved).map((r) => local(r.start_at)))).toEqual(new Set(["Thu 18:00"]));
  });

  it("a deleted occurrence stays deleted and an edited one isn't duplicated", () => {
    const rows = expand(series);
    const gone = rows[2].provider_event_id.split("::")[1];
    const edited = rows[3].provider_event_id.split("::")[1];
    let ics = addExdate(series, gone);
    ics = upsertOverride(ics, edited, { title: "Away game" });
    const moved = expand(shiftMaster(ics, 60 * 60_000, undefined, 60 * 60_000, LA));
    expect(moved).toHaveLength(rows.length - 1);
    expect(moved.filter((r) => r.title === "Away game")).toHaveLength(1);
  });
});
