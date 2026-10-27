// "Put in a slot" — the phone's tap twin of dropping a task on a block (D-172).
// The phone's calendar has no drag, so the task sheet lists what the drop would
// take. That list is `slotPicksFor`, built on the same `gatherActFor` the
// Schedule's drop uses, and these pin that the two can't disagree.
import { describe, expect, it } from "vitest";
import { gatherActFor, slotPickDay, slotPicksFor } from "../src/lib/slots";
import type { Slot, Task } from "../src/lib/types";

const DAY = "2026-10-27";
const at = (h: number, m = 0, day = 27) => new Date(2026, 9, day, h, m).toISOString();

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: "s1",
  user_id: "u",
  created_at: "",
  updated_at: "",
  title: "",
  do_date: DAY,
  start_time: at(13),
  duration_minutes: 60,
  project_id: null,
  domain_id: null,
  color: null,
  google_event_id: null,
  recurrence_id: null,
  recurrence_date: null,
  recurrence_overridden: false,
  ...over,
});

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: "me",
    title: "Draft the launch email",
    status: "planned",
    do_date: DAY,
    start_time: at(9, 30),
    duration_minutes: 45,
    slot_id: null,
    ...over,
  }) as Task;

const ids = (picks: ReturnType<typeof slotPicksFor>) =>
  picks.map((p) => (p.kind === "slot" ? `slot:${p.slot.id}` : `task:${p.task.id}`));

describe("slotPicksFor — what a task can be put in a slot with", () => {
  it("offers the day's slots (join) and timed tasks (combine), earliest first", () => {
    const picks = slotPicksFor(task(), DAY, {
      slots: [slot({ id: "late", start_time: at(17) }), slot({ id: "early", start_time: at(8) })],
      tasks: [task({ id: "call", start_time: at(11) })],
    });
    expect(ids(picks)).toEqual(["slot:early", "task:call", "slot:late"]);
    expect(picks.map((p) => p.act)).toEqual(["join", "combine", "join"]);
  });

  it("agrees with the drop: every row is one gatherActFor says yes to, with the same act", () => {
    const me = task();
    const slots = [slot({ id: "a" }), slot({ id: "rep", recurrence_id: "r1" }), slot({ id: "proj", project_id: "p9" })];
    const tasks = [task({ id: "open", start_time: at(11) }), task({ id: "done", status: "done", start_time: at(12) })];
    for (const p of slotPicksFor(me, DAY, { slots, tasks })) {
      const target = p.kind === "slot" ? ({ kind: "slot", slot: p.slot } as const) : ({ kind: "task", task: p.task } as const);
      expect(gatherActFor({ kind: "tasks", tasks: [me] }, target)).toBe(p.act);
    }
  });

  it("never offers a finished task, an untimed one, or itself", () => {
    const picks = slotPicksFor(task(), DAY, {
      slots: [],
      tasks: [
        task(), // itself
        task({ id: "done", status: "done", start_time: at(10) }),
        task({ id: "untimed", start_time: null }),
        task({ id: "trashed", status: "trashed", start_time: at(15) }),
      ],
    });
    expect(picks).toEqual([]);
  });

  it("leaves out the slot the task is already in — joining it would do nothing", () => {
    const picks = slotPicksFor(task({ slot_id: "here", start_time: null }), DAY, {
      slots: [slot({ id: "here" }), slot({ id: "there", start_time: at(15) })],
      tasks: [],
    });
    expect(ids(picks)).toEqual(["slot:there"]);
  });

  it("still offers a repeating slot and another project's sitting to JOIN — those guards are only for merging a slot away", () => {
    const picks = slotPicksFor(task(), DAY, {
      slots: [slot({ id: "rep", recurrence_id: "r1" }), slot({ id: "proj", project_id: "p9", start_time: at(15) })],
      tasks: [],
    });
    expect(ids(picks)).toEqual(["slot:rep", "slot:proj"]);
  });

  it("lists only the day asked for", () => {
    const picks = slotPicksFor(task(), DAY, {
      slots: [slot({ id: "tomorrow", start_time: at(9, 0, 28), do_date: "2026-10-28" })],
      tasks: [task({ id: "yesterday", start_time: at(9, 0, 26) })],
    });
    expect(picks).toEqual([]);
  });

  it("gives a finished task no list at all — it's a record, never anyone's child", () => {
    const picks = slotPicksFor(task({ status: "done" }), DAY, {
      slots: [slot()],
      tasks: [task({ id: "call", start_time: at(11) })],
    });
    expect(picks).toEqual([]);
  });

  it("works from an empty day — no slots, nothing timed, nothing offered", () => {
    expect(slotPicksFor(task(), DAY, { slots: [], tasks: [] })).toEqual([]);
  });
});

describe("slotPickDay — which day the list is read from", () => {
  it("is the day a timed task sits on", () => {
    expect(slotPickDay({ start_time: at(9, 30), do_date: DAY }, "2026-10-20")).toBe(DAY);
  });
  it("is the planned day for work with a day and no time (a slot's child)", () => {
    expect(slotPickDay({ start_time: null, do_date: "2026-10-29" }, "2026-10-20")).toBe("2026-10-29");
  });
  it("is today for work with no day yet, where a drag from the rail lands it", () => {
    expect(slotPickDay({ start_time: null, do_date: null }, "2026-10-20")).toBe("2026-10-20");
  });
});
