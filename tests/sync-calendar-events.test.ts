/**
 * A drag that rebuilds the whole event set blanks the block for a second.
 * The grid must mutate the one event that moved and leave the rest standing.
 */
import { describe, expect, it, vi } from "vitest";
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
  events: Map<string, CalendarBlockApi>;
} {
  const events = new Map<string, CalendarBlockApi>();

  const add = (input: CalendarBlockInput): CalendarBlockApi => {
    const rec: CalendarBlockApi = {
      id: input.id,
      title: input.title,
      start: new Date(input.start),
      end: input.end ? new Date(input.end) : null,
      allDay: Boolean(input.allDay),
      classNames: [...(input.classNames ?? [])],
      backgroundColor: input.backgroundColor ?? "",
      borderColor: input.borderColor ?? "",
      extendedProps: { ...(input.extendedProps ?? {}) },
      setDates: vi.fn((start, end, opts) => {
        rec.start = new Date(start);
        rec.end = end ? new Date(end) : null;
        if (opts?.allDay !== undefined) rec.allDay = opts.allDay;
      }),
      setProp: vi.fn((name, value) => {
        if (name === "title") rec.title = String(value);
        if (name === "classNames") rec.classNames = [...(value as string[])];
        if (name === "backgroundColor") rec.backgroundColor = String(value);
        if (name === "borderColor") rec.borderColor = String(value);
      }),
      setExtendedProp: vi.fn((name, value) => {
        rec.extendedProps = { ...rec.extendedProps, [name]: value };
      }),
      remove: vi.fn(() => {
        events.delete(input.id);
      }),
    };
    events.set(input.id, rec);
    return rec;
  };

  for (const e of initial) add(e);

  const api: CalendarGridApi = {
    getEvents: () => [...events.values()],
    getEventById: (id) => events.get(id) ?? null,
    addEvent: vi.fn((e: CalendarBlockInput) => add(e)),
  };

  return { api, events };
}

describe("syncCalendarEvents", () => {
  it("moves an existing block with setDates instead of remove+add", () => {
    const { api, events } = makeApi([
      block({ id: "task:1" }),
      block({ id: "task:2", start: "2026-09-01T16:00:00.000Z", end: "2026-09-01T16:30:00.000Z" }),
    ]);
    const next = [
      block({ id: "task:1", start: "2026-09-01T17:00:00.000Z", end: "2026-09-01T17:30:00.000Z" }),
      block({ id: "task:2", start: "2026-09-01T16:00:00.000Z", end: "2026-09-01T16:30:00.000Z" }),
    ];

    const report = syncCalendarEvents(api, next);

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

  it("does not setDates when FullCalendar already has the dropped times", () => {
    // The drag already moved the event. The cache patch must not poke it again.
    const { api } = makeApi([
      block({ id: "evt:1", start: "2026-09-01T18:00:00.000Z", end: "2026-09-01T19:00:00.000Z" }),
    ]);
    const report = syncCalendarEvents(api, [
      block({ id: "evt:1", start: "2026-09-01T18:00:00.000Z", end: "2026-09-01T19:00:00.000Z" }),
    ]);
    expect(report.moved).toEqual([]);
    expect(api.getEventById("evt:1")!.setDates).not.toHaveBeenCalled();
  });

  it("adds a newly scheduled block and drops one that left the grid", () => {
    const { api } = makeApi([block({ id: "task:old" })]);
    const report = syncCalendarEvents(api, [block({ id: "task:new" })]);
    expect(report.removed).toEqual(["task:old"]);
    expect(report.added).toEqual(["task:new"]);
    expect(api.getEventById("task:old")).toBeNull();
    expect(api.getEventById("task:new")).not.toBeNull();
  });

  it("patches title and slot children without moving the block", () => {
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
    const ev = api.getEventById("slot:1")!;
    expect(ev.setProp).toHaveBeenCalledWith("title", "Writing");
    expect(ev.setExtendedProp).toHaveBeenCalledWith("slotChildren", [{ title: "A", done: true }]);
    expect(ev.setDates).not.toHaveBeenCalled();
  });
});
