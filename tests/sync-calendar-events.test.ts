import { describe, expect, it, vi } from "vitest";
import { toFcInstant } from "../src/lib/dates";
import {
  syncCalendarEvents,
  type CalendarBlockApi,
  type CalendarBlockInput,
  type CalendarGridApi,
} from "../src/lib/syncCalendarEvents";

function block(over: Partial<CalendarBlockInput> & Pick<CalendarBlockInput, "id">): CalendarBlockInput {
  return {
    title: over.title ?? over.id,
    start: "2026-09-01T15:00:00.000Z",
    end: "2026-09-01T15:30:00.000Z",
    ...over,
  };
}

function makeApi(initial: CalendarBlockInput[] = []): {
  api: CalendarGridApi;
  events: { get: (id: string) => CalendarBlockApi | undefined };
  list: CalendarBlockApi[];
} {
  const list: CalendarBlockApi[] = [];

  const add = (input: CalendarBlockInput): CalendarBlockApi => {
    const record: CalendarBlockApi = {
      id: input.id,
      title: input.title,
      start: new Date(input.start),
      end: input.end ? new Date(input.end) : null,
      allDay: Boolean(input.allDay),
      classNames: [...(input.classNames ?? [])],
      backgroundColor: input.backgroundColor ?? "",
      borderColor: input.borderColor ?? "",
      textColor: input.textColor ?? "",
      display: input.display ?? "auto",
      extendedProps: { ...(input.extendedProps ?? {}) },
      setDates: vi.fn((start, end, options) => {
        record.start = new Date(start);
        record.end = end ? new Date(end) : null;
        if (options?.allDay !== undefined) record.allDay = options.allDay;
      }),
      setProp: vi.fn((name, value) => {
        if (name === "title") record.title = String(value);
        if (name === "classNames") record.classNames = [...(value as string[])];
        if (name === "backgroundColor") record.backgroundColor = String(value);
        if (name === "borderColor") record.borderColor = String(value);
        if (name === "textColor") record.textColor = String(value);
        if (name === "display") record.display = String(value);
      }),
      setExtendedProp: vi.fn((name, value) => {
        record.extendedProps = { ...record.extendedProps, [name]: value };
      }),
      remove: vi.fn(() => {
        const i = list.indexOf(record);
        if (i >= 0) list.splice(i, 1);
      }),
    };
    list.push(record);
    return record;
  };

  for (const event of initial) add(event);

  const api: CalendarGridApi = {
    getEvents: () => [...list],
    getEventById: (id) => list.find((e) => e.id === id) ?? null,
    addEvent: vi.fn((event: CalendarBlockInput) => add(event)),
  };

  return {
    api,
    list,
    // First-match view so existing tests that keyed a Map still read one event.
    events: {
      get: (id: string) => list.find((e) => e.id === id),
    },
  };
}

describe("syncCalendarEvents", () => {
  it("moves one block in place without rebuilding the event set", () => {
    const { api, events } = makeApi([
      block({ id: "task:1" }),
      block({
        id: "task:2",
        start: "2026-09-01T16:00:00.000Z",
        end: "2026-09-01T16:30:00.000Z",
      }),
    ]);
    const report = syncCalendarEvents(api, [
      block({
        id: "task:1",
        start: "2026-09-01T17:00:00.000Z",
        end: "2026-09-01T17:30:00.000Z",
      }),
      block({
        id: "task:2",
        start: "2026-09-01T16:00:00.000Z",
        end: "2026-09-01T16:30:00.000Z",
      }),
    ]);

    expect(report.moved).toEqual(["task:1"]);
    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(api.addEvent).not.toHaveBeenCalled();
    expect(events.get("task:2")!.remove).not.toHaveBeenCalled();
    expect(events.get("task:2")!.setDates).not.toHaveBeenCalled();
    expect(events.get("task:1")!.setDates).toHaveBeenCalledWith(
      "2026-09-01T17:00:00.000Z",
      "2026-09-01T17:30:00.000Z",
      { allDay: false },
    );
  });

  it("does not move a block again when FullCalendar already has the dropped times", () => {
    const { api } = makeApi([
      block({
        id: "evt:1",
        start: "2026-09-01T18:00:00.000Z",
        end: "2026-09-01T19:00:00.000Z",
        display: "block",
        textColor: "white",
      }),
    ]);

    const report = syncCalendarEvents(api, [
      block({
        id: "evt:1",
        start: "2026-09-01T18:00:00.000Z",
        end: "2026-09-01T19:00:00.000Z",
        display: "block",
        textColor: "white",
      }),
    ]);

    expect(report.moved).toEqual([]);
    expect(report.patched).toEqual([]);
    expect(api.getEventById("evt:1")!.setDates).not.toHaveBeenCalled();
    expect(api.getEventById("evt:1")!.setProp).not.toHaveBeenCalled();
  });

  it("adds a newly scheduled block and removes one that left the grid", () => {
    const { api } = makeApi([block({ id: "task:old" })]);
    const report = syncCalendarEvents(api, [block({ id: "task:new" })]);

    expect(report.removed).toEqual(["task:old"]);
    expect(report.added).toEqual(["task:new"]);
    expect(api.getEventById("task:old")).toBeNull();
    expect(api.getEventById("task:new")).not.toBeNull();
  });

  it("patches event content without moving its geometry", () => {
    const { api } = makeApi([
      block({
        id: "slot:1",
        title: "Deep work",
        extendedProps: { slotChildren: [{ title: "A", done: false }] },
      }),
    ]);

    const report = syncCalendarEvents(api, [
      block({
        id: "slot:1",
        title: "Writing",
        extendedProps: { slotChildren: [{ title: "A", done: true }] },
      }),
    ]);

    expect(report.moved).toEqual([]);
    expect(report.patched).toEqual(["slot:1"]);
    const event = api.getEventById("slot:1")!;
    expect(event.setProp).toHaveBeenCalledWith("title", "Writing");
    expect(event.setExtendedProp).toHaveBeenCalledWith("slotChildren", [
      { title: "A", done: true },
    ]);
    expect(event.setDates).not.toHaveBeenCalled();
  });
});

describe("the reconcile is batched", () => {
  /**
   * Every addEvent/setDates/setProp is its own FullCalendar action, and each one
   * re-renders and re-measures the whole grid. Paging one week re-adds ~80
   * events: measured on a real account that was 24,184 forced layouts and a
   * single 1,467ms frame, versus 284 layouts and 73ms wrapped in
   * `batchRendering`. If this regresses, the Schedule freezes on every week
   * change and on every write that lands mid-drag.
   */
  it("performs every mutation inside batchRendering when the api offers it", () => {
    const { api } = makeApi([block({ id: "stays" }), block({ id: "goes" })]);
    let depth = 0;
    let maxDepth = 0;
    const outside: string[] = [];
    const batched: CalendarGridApi = {
      getEvents: () => api.getEvents(),
      getEventById: (id) => api.getEventById(id),
      addEvent: (e) => { if (depth === 0) outside.push(`addEvent:${e.id}`); return api.addEvent(e); },
      batchRendering: (fn) => { depth++; maxDepth = Math.max(maxDepth, depth); fn(); depth--; },
    };
    const res = syncCalendarEvents(batched, [block({ id: "stays", title: "renamed" }), block({ id: "new" })]);

    expect(maxDepth, "the reconcile must run inside batchRendering").toBe(1);
    expect(outside, "no event mutation may happen outside the batch").toEqual([]);
    expect(res.added).toEqual(["new"]);
    expect(res.removed).toEqual(["goes"]);
  });

  it("still reconciles identically when the api has no batchRendering", () => {
    const withBatch = makeApi([block({ id: "a" }), block({ id: "drop" })]);
    const noBatch = makeApi([block({ id: "a" }), block({ id: "drop" })]);
    const next = [block({ id: "a", title: "moved", start: "2026-09-02T15:00:00.000Z" }), block({ id: "b" })];

    const wrapped: CalendarGridApi = { ...withBatch.api, batchRendering: (fn) => fn() };
    expect(syncCalendarEvents(wrapped, next)).toEqual(syncCalendarEvents(noBatch.api, next));
  });
});

describe("duplicate publicIds from an inbox drop", () => {
  /**
   * External drop keeps a ghost with id `task:<id>`. If getEventById misses it
   * for a frame, addEvent creates a second def with the same publicId — one at
   * the drop time, one from midnight to the real end. Deleting either removes
   * both because they share the id. Collapse to the timed block that matches.
   */
  it("keeps the timed block and drops the midnight overlay", () => {
    const { api, list } = makeApi([
      block({
        id: "task:1",
        start: "2026-09-03T07:00:00.000Z", // local midnight PDT
        end: "2026-09-03T23:30:00.000Z",
      }),
    ]);
    api.addEvent(
      block({
        id: "task:1",
        start: "2026-09-03T23:00:00.000Z",
        end: "2026-09-03T23:30:00.000Z",
      }),
    );
    expect(list.filter((e) => e.id === "task:1")).toHaveLength(2);

    const report = syncCalendarEvents(api, [
      block({
        id: "task:1",
        start: "2026-09-03T23:00:00.000Z",
        end: "2026-09-03T23:30:00.000Z",
        allDay: false,
      }),
    ]);

    expect(list.filter((e) => e.id === "task:1")).toHaveLength(1);
    expect(list[0]!.start!.toISOString()).toBe("2026-09-03T23:00:00.000Z");
    expect(report.removed).toEqual(["task:1"]);
    expect(report.added).toEqual([]);
  });

  it("prefers a timed input when next lists the same id as all-day too", () => {
    const { api, list } = makeApi();
    const timed = block({
      id: "task:1",
      start: "2026-09-03T23:00:00.000Z",
      end: "2026-09-03T23:30:00.000Z",
      allDay: false,
    });
    const allDay = block({
      id: "task:1",
      start: "2026-09-03",
      allDay: true,
    });
    const report = syncCalendarEvents(api, [allDay, timed]);

    expect(report.added).toEqual(["task:1"]);
    expect(list).toHaveLength(1);
    expect(list[0]!.allDay).toBe(false);
    expect(list[0]!.start!.toISOString()).toBe("2026-09-03T23:00:00.000Z");
  });
});

describe("toFcInstant", () => {
  it("rewrites a Postgres-style timestamptz so FullCalendar sees a time", () => {
    expect(toFcInstant("2026-09-03 23:00:00+00")).toBe("2026-09-03T23:00:00.000Z");
  });

  it("rewrites a space form with a colon-less offset", () => {
    expect(toFcInstant("2026-09-03 23:00:00+00:00")).toBe("2026-09-03T23:00:00.000Z");
  });

  it("leaves an already-UTC instant unchanged", () => {
    expect(toFcInstant("2026-09-03T23:00:00.000Z")).toBe("2026-09-03T23:00:00.000Z");
  });
});
