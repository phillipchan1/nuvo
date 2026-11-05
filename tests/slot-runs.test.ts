// The day's clock with slots kept whole — what the rail and the phone both draw.
import { describe, expect, it } from "vitest";
import { clockEntries, clockTaskIds, slotState, todayWithSlotChildren, type SlotRun } from "../src/lib/slotRuns";
import type { Slot, Task } from "../src/lib/types";

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m).toISOString();

const slot = (id: string, h: number, over: Partial<Slot> = {}): Slot => ({
  id,
  user_id: "u",
  created_at: "",
  updated_at: "",
  title: "",
  do_date: "2026-11-05",
  start_time: at(h),
  duration_minutes: 120,
  project_id: null,
  domain_id: null,
  color: null,
  google_event_id: null,
  recurrence_id: null,
  recurrence_date: null,
  recurrence_overridden: false,
  ...over,
});

const task = (id: string, h: number | null, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    status: "planned",
    start_time: h == null ? null : at(h),
    duration_minutes: 30,
    slot_id: null,
    sort_order: 0,
    ...over,
  }) as Task;

describe("clockEntries", () => {
  it("folds a slot's tasks into ONE entry standing at the slot's start, among the lone tasks", () => {
    const out = clockEntries(
      [task("call", 9), task("a", 6, { slot_id: "s1" }), task("b", 6, { slot_id: "s1" }), task("lunch", 12)],
      [slot("s1", 6)],
    );
    expect(out.map((e) => (e.kind === "slot" ? `slot:${e.slot.id}` : e.task.id))).toEqual(["slot:s1", "call", "lunch"]);
    const run = out[0] as SlotRun;
    expect(run.open.map((t) => t.id)).toEqual(["a", "b"]);
    expect(run.askMinutes).toBe(60);
  });

  it("keeps a slot's tasks in the slot's own hand order, not the order they arrived", () => {
    const [run] = clockEntries(
      [task("late", 6, { slot_id: "s1", sort_order: 5 }), task("early", 6, { slot_id: "s1", sort_order: 1 })],
      [slot("s1", 6)],
    ) as SlotRun[];
    expect(run.open.map((t) => t.id)).toEqual(["early", "late"]);
  });

  it("still lists an EMPTY slot — held time with nothing in it is a fact worth saying", () => {
    const out = clockEntries([task("call", 9)], [slot("s1", 6)]);
    expect(out[0].kind).toBe("slot");
    expect(slotState(out[0] as SlotRun)).toBe("empty");
  });

  it("reads a slot whose work is all done as done, not empty", () => {
    const out = clockEntries([], [slot("s1", 6)], [task("x", 6, { slot_id: "s1", status: "done" })]);
    const run = out[0] as SlotRun;
    expect(run.doneCount).toBe(1);
    expect(slotState(run)).toBe("done");
  });

  it("stands the slot before a lone task at the same minute — the container comes first", () => {
    const out = clockEntries([task("solo", 6)], [slot("s1", 6)]);
    expect(out.map((e) => e.kind)).toEqual(["slot", "task"]);
  });

  it("treats a task pointing at a slot we weren't handed as a lone task rather than dropping it", () => {
    const out = clockEntries([task("orphan", 7, { slot_id: "elsewhere" })], []);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("task");
  });

  it("is empty on an empty day — nothing invented for a stranger's account (P7)", () => {
    expect(clockEntries([], [])).toEqual([]);
  });
});

describe("clockTaskIds", () => {
  it("flattens in draw order — the order ⇧-click ranges and j / k walk", () => {
    const entries = clockEntries(
      [task("a", 6, { slot_id: "s1", sort_order: 1 }), task("b", 6, { slot_id: "s1", sort_order: 2 }), task("c", 9)],
      [slot("s1", 6)],
    );
    expect(clockTaskIds(entries)).toEqual(["a", "b", "c"]);
  });
});

describe("todayWithSlotChildren — today as a list draws it", () => {
  const same = (t: Task) => t;
  const today = "2026-11-05";

  it("stamps a slot child with its slot's start — the DB leaves the child's own null", () => {
    const out = todayWithSlotChildren({
      dayRows: [],
      slotChildren: [task("a", null, { slot_id: "s1" })],
      slots: [slot("s1", 6)],
      today,
      resolve: same,
    });
    expect(out).toHaveLength(1);
    expect(out[0].start_time).toBe(at(6));
  });

  it("ignores children of a slot that isn't today's", () => {
    const out = todayWithSlotChildren({
      dayRows: [],
      slotChildren: [task("a", null, { slot_id: "other-day" })],
      slots: [slot("other-day", 6, { do_date: "2026-11-06" })],
      today,
      resolve: same,
    });
    expect(out).toEqual([]);
  });

  it("lists a task once when an optimistic assign left it in the day rows AND the slot's children", () => {
    const t = task("a", null, { slot_id: "s1" });
    const out = todayWithSlotChildren({ dayRows: [t], slotChildren: [t], slots: [slot("s1", 6)], today, resolve: same });
    expect(out).toHaveLength(1);
    expect(out[0].start_time).toBe(at(6));
  });

  it("drops trashed rows and rows the cache can't resolve", () => {
    const out = todayWithSlotChildren({
      dayRows: [task("gone", 9, { status: "trashed" }), task("lost", 10), task("kept", 11)],
      slotChildren: [],
      slots: [],
      today,
      resolve: (t) => (t.id === "lost" ? undefined : t),
    });
    expect(out.map((t) => t.id)).toEqual(["kept"]);
  });
});
