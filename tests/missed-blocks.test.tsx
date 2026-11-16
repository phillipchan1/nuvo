// @vitest-environment jsdom
// A block whose time passed with work still in it (D-232). Two failures this
// pins: the work inside a passed block was never offered back (the repair
// skipped a block's tasks AND every passed block), and the rail's "Next:" kept
// naming an 8:30 task at 9:40 because it ignored the clock.

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWeekRepair } from "../src/hooks/useWeekRepair";
import { dayNextTask, readDay } from "../src/lib/marks";
import type { Slot, Task } from "../src/lib/types";

// Monday 16 Nov 2026, 9:40am local
const NOW = new Date(2026, 10, 16, 9, 40);
const iso = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

const task = (id: string, o: Partial<Task> = {}): Task =>
  ({ id, title: id, start_time: null, duration_minutes: 30, status: "planned", project_id: "p", energy: null, deadline: null, initiative_id: null, domain_id: null, slot_id: null, recurrence_id: null, sort_order: 0, do_date: "2026-11-16", ...o }) as unknown as Task;
const slot = (id: string, start: string, mins: number, o: Partial<Slot> = {}): Slot =>
  ({ id, title: id, start_time: start, do_date: "2026-11-16", duration_minutes: mins, project_id: "p", domain_id: null, color: null, recurrence_id: null, ...o }) as unknown as Slot;

const repairs = (tasks: Task[], slots: Slot[]) =>
  renderHook(() =>
    useWeekRepair({
      tasks,
      events: [],
      slots,
      hiddenCalendarIds: [],
      hiddenEventKeys: [],
      workStartMin: 8 * 60,
      workEndMin: 17 * 60 + 30,
      workingDays: [1, 2, 3, 4, 5],
      now: NOW,
      enabled: true,
    }),
  ).result.current;

describe("a block whose time passed with work in it", () => {
  const mathy = slot("Find a New Name for Mathy", iso(16, 8, 30), 30);

  it("nothing done in it → the whole block is offered back", () => {
    const rs = repairs([task("List", { slot_id: mathy.id }), task("Pick", { slot_id: mathy.id })], [mathy]);
    expect(rs.map((r) => [r.kind, r.title, r.why])).toEqual([["slot", "Find a New Name for Mathy", "missed"]]);
    expect(rs[0].options.length).toBeGreaterThan(0);
  });

  it("some of it done → the block stays, only what's undone moves", () => {
    const rs = repairs([task("List", { slot_id: mathy.id }), task("Pick", { slot_id: mathy.id }), task("Done one", { slot_id: mathy.id, status: "done" })], [mathy]);
    expect(rs).toHaveLength(1);
    expect(rs[0].kind).toBe("leftover");
    expect(rs[0].title).toBe("Rest of Find a New Name for Mathy");
    expect(rs[0].leftover!.map((t) => t.id)).toEqual(["List", "Pick"]);
    // "was" names the block as it was; the move is sized to what is left
    expect(rs[0].from.durationMin).toBe(30);
    expect(rs[0].moveMin).toBe(30);
  });

  it("one undone task left → it's named, and it's the row Other times asks about", () => {
    const rs = repairs([task("List", { slot_id: mathy.id }), task("Pick", { slot_id: mathy.id, status: "done" })], [mathy]);
    expect(rs.map((r) => [r.kind, r.title, r.id])).toEqual([["leftover", "List", "List"]]);
  });

  it("a standing block never moves — its undone work does", () => {
    const focus = slot("Morning Focus", iso(16, 6, 30), 60, { recurrence_id: "r" });
    const rs = repairs([task("Review", { slot_id: focus.id })], [focus]);
    expect(rs.map((r) => r.kind)).toEqual(["leftover"]);
  });

  it("says nothing when everything in it was done, or before the grace runs out", () => {
    expect(repairs([task("List", { slot_id: mathy.id, status: "done" })], [mathy])).toEqual([]);
    const late = slot("Just ended", iso(16, 9, 0), 30); // ended 9:30, grace to 9:45
    expect(repairs([task("x", { slot_id: late.id })], [late])).toEqual([]);
  });
});

describe("Next: says what's ahead, not what was missed", () => {
  const mathy = slot("Mathy", iso(16, 8, 30), 30);
  // the rail hands a block's tasks the block's start (lib/slotRuns)
  const inMathy = task("Create a candidate-name list", { slot_id: mathy.id, start_time: mathy.start_time });
  const gym = task("Gym", { start_time: iso(16, 9, 30), duration_minutes: 60, project_id: null });
  const later = task("Request access", { start_time: iso(16, 14), project_id: null });
  const day = readDay([inMathy, gym, later], 990);

  it("skips a task whose block was missed", () => {
    expect(dayNextTask(day, NOW.getTime(), [mathy])?.title).toBe("Gym");
  });
  it("still names it while it's under way", () => {
    expect(dayNextTask(day, new Date(2026, 10, 16, 8, 45).getTime(), [mathy])?.title).toBe("Create a candidate-name list");
  });
  it("names an untimed task once every timed one is behind", () => {
    const loose = task("Loose", { project_id: null });
    const d = readDay([inMathy, loose], 990);
    expect(dayNextTask(d, NOW.getTime(), [mathy])?.title).toBe("Loose");
  });
});

describe("a missed block goes back today while today has room", () => {
  it("offers today first, then the rest of the week", () => {
    const loose = { ...task("Calls", { project_id: null }), start_time: iso(16, 8, 30) } as Task;
    const [r] = repairs([loose], []);
    expect(r.options[0].dayISO).toBe("2026-11-16");
    expect(r.options[0].startMin).toBeGreaterThanOrEqual(9 * 60 + 40);
    expect(r.options.some((o) => o.dayISO !== "2026-11-16")).toBe(true);
  });
  it("falls to another day when today is full", () => {
    const loose = { ...task("Calls", { project_id: null }), start_time: iso(16, 8, 30) } as Task;
    const wall = { ...task("Wall", { project_id: null }), start_time: iso(16, 9, 45), duration_minutes: 8 * 60 } as Task;
    const [r] = repairs([loose, wall], []);
    expect(r.options[0].dayISO).not.toBe("2026-11-16");
  });
});
