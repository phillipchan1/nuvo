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
        events.delete(input.id);
      }),
    };
    events.set(input.id, record);
    return record;
  };

  for (const event of initial) add(event);

  const api: CalendarGridApi = {
    getEvents: () => [...events.values()],
    getEventById: (id) => events.get(id) ?? null,
    addEvent: vi.fn((event: CalendarBlockInput) => add(event)),
  };

  return { api, events };
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
