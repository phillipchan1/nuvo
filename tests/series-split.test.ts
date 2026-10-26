import { describe, expect, it } from "vitest";
import {
  addExdate,
  buildEvent,
  patchMaster,
  shiftMaster,
  splitSeries,
  upsertOverride,
  withoutOverrides,
} from "../supabase/functions/_shared/icalwrite.ts";
import { countRuleOccurrencesBefore, parseIcs } from "../supabase/functions/_shared/ics.ts";
import { capRRule, recountRRule, rruleCount } from "../supabase/functions/_shared/recurrence.ts";

const LA = "America/Los_Angeles";
const START = "2026-10-29T01:00:00.000Z"; // Wed Oct 28, 6pm PDT
const END = "2026-10-29T02:00:00.000Z";

function expand(ics: string) {
  return parseIcs(ics, {
    userId: "u",
    accountId: "a",
    windowStart: new Date("2026-10-01"),
    windowEnd: new Date("2027-01-31"),
    runStamp: "now",
  }).rows;
}
const local = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: LA, weekday: "short", month: "short", day: "numeric", hour: "numeric", hourCycle: "h23" });

const weekly = (extra: string[] = ["RRULE:FREQ=WEEKLY;BYDAY=WE"]) =>
  buildEvent({ uid: "soccer", title: "Kids' soccer", startISO: START, endISO: END, recurrence: extra, timeZone: LA });

describe("RRULE split helpers", () => {
  it("caps a rule and drops COUNT/UNTIL", () => {
    expect(capRRule(["RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=WE", "EXDATE:20261104T010000Z"], "20261110T075959Z")).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110T075959Z",
      "EXDATE:20261104T010000Z",
    ]);
  });
  it("reads and recounts COUNT", () => {
    expect(rruleCount(["RRULE:FREQ=WEEKLY;COUNT=10"])).toBe(10);
    expect(rruleCount(["RRULE:FREQ=WEEKLY"])).toBeNull();
    expect(recountRRule(["RRULE:FREQ=WEEKLY;COUNT=10"], 7)).toEqual(["RRULE:FREQ=WEEKLY;COUNT=7"]);
  });
});

describe("this and following on an Apple series", () => {
  const series = weekly();
  const rows = expand(series);
  const third = rows[2]; // Wed Nov 11
  const suffix = third.provider_event_id.split("::")[1];

  it("splits into a head that ends before and a tail that starts at the occurrence", () => {
    const split = splitSeries(series, suffix, { newUid: "soccer-2" })!;
    const head = expand(split.head);
    const tail = expand(split.tail);
    expect(head.map((r) => r.start_at)).toEqual(rows.slice(0, 2).map((r) => r.start_at));
    expect(tail.map((r) => r.start_at)).toEqual(rows.slice(2).map((r) => r.start_at));
    expect(tail.every((r) => r.provider_event_id.startsWith("soccer-2::"))).toBe(true);
    expect(split.occurrenceISO).toBe(third.start_at);
  });

  it("from the first occurrence there is nothing to split — that's ALL", () => {
    expect(splitSeries(series, rows[0].provider_event_id.split("::")[1], { newUid: "x" })).toBeNull();
  });

  it("moving this and following an hour later leaves the earlier weeks alone", () => {
    const split = splitSeries(series, suffix, { newUid: "soccer-2" })!;
    const tail = shiftMaster(split.tail, 3_600_000, undefined, 3_600_000, LA);
    const all = [...expand(split.head), ...expand(tail)].sort((a, b) => a.start_at.localeCompare(b.start_at));
    expect(all.map((r) => local(r.start_at))).toEqual([
      "Wed, Oct 28, 18",
      "Wed, Nov 4, 18",
      ...rows.slice(2).map((r) => local(new Date(new Date(r.start_at).getTime() + 3_600_000).toISOString())),
    ]);
    expect(all.slice(2).every((r) => local(r.start_at).endsWith("19"))).toBe(true);
  });

  it("moving this and following to Thursday moves only the later weeks' day", () => {
    const split = splitSeries(series, suffix, { newUid: "soccer-2" })!;
    const tail = expand(shiftMaster(split.tail, 86_400_000, undefined, 86_400_000, LA));
    expect(new Set(tail.map((r) => local(r.start_at).slice(0, 3)))).toEqual(new Set(["Thu"]));
    expect(new Set(expand(split.head).map((r) => local(r.start_at).slice(0, 3)))).toEqual(new Set(["Wed"]));
  });

  it("a new rule from here on applies to the tail only", () => {
    const split = splitSeries(series, suffix, { newUid: "soccer-2" })!;
    const tail = expand(withoutOverrides(patchMaster(split.tail, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], timeZone: LA })));
    expect(new Set(tail.map((r) => local(r.start_at).slice(0, 3)))).toEqual(new Set(["Mon", "Wed"]));
    expect(expand(split.head)).toHaveLength(2);
  });

  it("delete this and following keeps only the earlier weeks", () => {
    const split = splitSeries(series, suffix, { newUid: "unused" })!;
    expect(expand(split.head)).toHaveLength(2);
  });

  it("edits and deletions after the split travel with the tail; earlier ones stay", () => {
    let ics = upsertOverride(series, rows[1].provider_event_id.split("::")[1], { title: "Early edit" });
    ics = upsertOverride(ics, rows[4].provider_event_id.split("::")[1], { title: "Late edit" });
    ics = addExdate(ics, rows[5].provider_event_id.split("::")[1]);
    const split = splitSeries(ics, suffix, { newUid: "soccer-2" })!;
    const head = expand(split.head);
    const tail = expand(split.tail);
    expect(head.map((r) => r.title)).toEqual(["Kids' soccer", "Early edit"]);
    expect(tail.filter((r) => r.title === "Late edit")).toHaveLength(1);
    expect(tail.some((r) => r.start_at === rows[5].start_at)).toBe(false);
    expect(head.length + tail.length).toBe(rows.length - 1);
  });

  it("a COUNT series hands the tail what's left", () => {
    const counted = weekly(["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=6"]);
    const crows = expand(counted);
    expect(crows).toHaveLength(6);
    const before = countRuleOccurrencesBefore(counted, new Date(crows[2].start_at).getTime());
    expect(before).toBe(2);
    const split = splitSeries(counted, crows[2].provider_event_id.split("::")[1], { newUid: "c2", countBefore: before })!;
    expect(expand(split.head)).toHaveLength(2);
    expect(expand(split.tail)).toHaveLength(4);
  });

  it("an all-day series ends the day before", () => {
    const allDay = buildEvent({
      uid: "trash",
      title: "Trash night",
      startISO: "2026-10-28T00:00:00.000Z",
      endISO: "2026-10-29T00:00:00.000Z",
      allDay: true,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    });
    const arows = expand(allDay);
    const split = splitSeries(allDay, arows[3].provider_event_id.split("::")[1], { newUid: "t2" })!;
    expect(split.head).toMatch(/UNTIL=20261117(;|\r|$)/);
    expect(expand(split.head)).toHaveLength(3);
    expect(expand(split.tail)[0].start_at).toBe(arows[3].start_at);
    expect(expand(split.head).length + expand(split.tail).length).toBe(arows.length);
  });
});

import { planGoogleSplit } from "../supabase/functions/_shared/googleSplit.ts";

describe("this and following on a Google series", () => {
  const master = {
    id: "m1",
    summary: "Kids' soccer",
    start: { dateTime: "2026-10-28T18:00:00-07:00", timeZone: LA },
    end: { dateTime: "2026-10-28T19:00:00-07:00", timeZone: LA },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    attendees: [{ email: "coach@example.com" }],
    organizer: { self: true },
  };
  // Wed Nov 11, 6pm PST = 02:00Z on the 12th.
  const instance = { id: "m1_20261112T020000Z", originalStartTime: { dateTime: "2026-11-11T18:00:00-08:00", timeZone: LA } };
  const current = { start_at: "2026-11-12T02:00:00.000Z", end_at: "2026-11-12T03:00:00.000Z" };

  it("ends the old series one second before the occurrence, in UTC", () => {
    const plan = planGoogleSplit(master, instance, current, null, {})!;
    expect(plan.headRecurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261112T015959Z"]);
    expect(plan.tail).toBeNull();
  });

  it("starts the new series at the occurrence, in the series' zone, carrying guests", () => {
    const plan = planGoogleSplit(master, instance, current, { title: "Soccer (fall)" }, {})!;
    expect(plan.tail).toMatchObject({
      summary: "Soccer (fall)",
      start: { dateTime: "2026-11-12T02:00:00.000Z", timeZone: LA },
      end: { dateTime: "2026-11-12T03:00:00.000Z", timeZone: LA },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      attendees: [{ email: "coach@example.com" }],
    });
  });

  it("moving to Thursday moves the new series' day, not the old one's", () => {
    const plan = planGoogleSplit(master, instance, current, {
      start_at: "2026-11-13T02:00:00.000Z",
      end_at: "2026-11-13T03:00:00.000Z",
    }, {})!;
    expect(plan.tail!.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
    expect(plan.headRecurrence[0]).toContain("BYDAY=WE");
  });

  it("a new rule from here on, and COUNT carried over", () => {
    expect(planGoogleSplit(master, instance, current, { recurrence: ["RRULE:FREQ=DAILY"] }, {})!.tail!.recurrence)
      .toEqual(["RRULE:FREQ=DAILY"]);
    const counted = { ...master, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10"] };
    const plan = planGoogleSplit(counted, instance, current, {}, { remaining: 8 })!;
    expect(plan.tail!.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8"]);
    expect(plan.headRecurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261112T015959Z"]);
  });

  it("stopping the repeat from here leaves one event", () => {
    const plan = planGoogleSplit(master, instance, current, { recurrence: null }, {})!;
    expect(plan.tail!.recurrence).toBeUndefined();
  });

  it("from the first occurrence it is ALL", () => {
    const first = { originalStartTime: master.start };
    expect(planGoogleSplit(master, first, current, {}, {})).toBeNull();
  });

  it("an all-day series ends the day before, as a DATE", () => {
    const allDay = { ...master, start: { date: "2026-10-28" }, end: { date: "2026-10-29" } };
    const plan = planGoogleSplit(allDay, { originalStartTime: { date: "2026-11-11" } }, current, {}, {})!;
    expect(plan.headRecurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261110"]);
    expect(plan.tail).toMatchObject({ start: { date: "2026-11-11" }, end: { date: "2026-11-12" } });
  });
});

import { applySeriesPatch, seriesScopeIds } from "../src/lib/eventActuals";

describe("the grid's optimistic series scopes", () => {
  const row = (id: string, day: number) => ({
    id,
    provider_event_id: `soccer::202611${String(day).padStart(2, "0")}T180000`,
    recurring_event_id: null,
    start_at: `2026-11-${String(day).padStart(2, "0")}T02:00:00.000Z`,
    end_at: `2026-11-${String(day).padStart(2, "0")}T03:00:00.000Z`,
    title: "Soccer",
    location: null,
    all_day: false,
  });
  const rows = [row("a", 4), row("b", 11), row("c", 18), row("d", 25), { ...row("x", 18), provider_event_id: "other" }];

  it("delete this and following takes the later occurrences only", () => {
    expect([...seriesScopeIds(rows, "b", "FOLLOWING")].sort()).toEqual(["b", "c", "d"]);
    expect([...seriesScopeIds(rows, "b", "ALL")].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...seriesScopeIds(rows, "b", "THIS")]).toEqual(["b"]);
  });

  it("edit this and following retitles the later occurrences only", () => {
    const next = applySeriesPatch(rows, "c", { title: "Away" }, { following: true });
    expect(next.map((r) => r.title)).toEqual(["Soccer", "Soccer", "Away", "Away", "Soccer"]);
  });
});
