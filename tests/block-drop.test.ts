// The drop rules for blocks that hold work — what letting go on a task or a
// slot does. The tracker shows these and the drop handlers write them, so they
// live once, in `lib/slots`, and are pinned here.
import { describe, expect, it } from "vitest";
import {
  blockDropZoneFromPointer,
  gatherActFor,
  minutesLeftInDay,
  planMakeSlot,
  resolveBlockDrop,
  slotMinutesFor,
  type DragPayload,
} from "../src/lib/slots";
import type { Slot, Task } from "../src/lib/types";

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: "s1",
  user_id: "u",
  created_at: "",
  updated_at: "",
  title: "",
  do_date: "2026-10-27",
  start_time: new Date(2026, 9, 27, 9, 0).toISOString(),
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
    id: "t1",
    title: "Write intro",
    status: "planned",
    start_time: new Date(2026, 9, 27, 9, 0).toISOString(),
    duration_minutes: 60,
    slot_id: null,
    ...over,
  }) as Task;

const rect = { left: 100, right: 300, top: 50, bottom: 150, width: 200 };

describe("blockDropZoneFromPointer — edges place beside, the middle gathers", () => {
  it("reads the left and right bands as beside, both the same", () => {
    expect(blockDropZoneFromPointer(rect, 105, 100)).toBe("beside");
    expect(blockDropZoneFromPointer(rect, 295, 100)).toBe("beside");
  });
  it("reads the middle as inside", () => {
    expect(blockDropZoneFromPointer(rect, 200, 60)).toBe("inside");
    expect(blockDropZoneFromPointer(rect, 200, 145)).toBe("inside");
  });
  it("has no top or bottom band — open time above and below already means before and after", () => {
    expect(blockDropZoneFromPointer(rect, 200, 51)).toBe("inside");
  });
  it("is nothing outside the block", () => {
    expect(blockDropZoneFromPointer(rect, 99, 100)).toBeNull();
    expect(blockDropZoneFromPointer(rect, 200, 151)).toBeNull();
  });
  it("is all middle when the block is too narrow to aim at an edge of", () => {
    const narrow = { left: 0, right: 40, top: 0, bottom: 40, width: 40 };
    expect(blockDropZoneFromPointer(narrow, 2, 20)).toBe("inside");
  });
});

describe("gatherActFor — what the middle of a block does with what's in hand", () => {
  const tasks = (...ts: Partial<Task>[]): DragPayload => ({ kind: "tasks", tasks: ts.map((t) => task(t)) });

  it("work on a slot joins it", () => {
    expect(gatherActFor(tasks({ id: "a" }), { kind: "slot", slot: slot() })).toBe("join");
    expect(gatherActFor({ kind: "project" }, { kind: "slot", slot: slot() })).toBe("join");
  });

  it("work on a task combines into a new slot", () => {
    expect(gatherActFor(tasks({ id: "a" }), { kind: "task", task: task() })).toBe("combine");
    expect(gatherActFor(tasks({ id: "a" }, { id: "b" }), { kind: "task", task: task() })).toBe("combine");
  });

  it("never combines a task with itself, even inside a group that holds it", () => {
    expect(gatherActFor(tasks({ id: "t1" }), { kind: "task", task: task() })).toBeNull();
    expect(gatherActFor(tasks({ id: "t1" }, { id: "b" }), { kind: "task", task: task() })).toBe("combine");
  });

  it("a finished block is a record, not a container — on either side", () => {
    expect(gatherActFor(tasks({ id: "a" }), { kind: "task", task: task({ status: "done" }) })).toBeNull();
    expect(gatherActFor(tasks({ id: "a", status: "done" }), { kind: "task", task: task() })).toBeNull();
  });

  it("a task with no clock can't start a slot", () => {
    expect(gatherActFor(tasks({ id: "a" }), { kind: "task", task: task({ start_time: null }) })).toBeNull();
  });

  it("a project lands as its own sitting beside a task", () => {
    expect(gatherActFor({ kind: "project" }, { kind: "task", task: task() })).toBeNull();
  });

  it("events never gather, and nothing gathers into one", () => {
    expect(gatherActFor({ kind: "other" }, { kind: "slot", slot: slot() })).toBeNull();
    expect(gatherActFor({ kind: "other" }, { kind: "task", task: task() })).toBeNull();
  });

  it("a slot on a task takes the task in", () => {
    const payload: DragPayload = { kind: "slot", slot: slot({ id: "s2" }), children: [] };
    expect(gatherActFor(payload, { kind: "task", task: task() })).toBe("absorb");
  });

  describe("a slot on a slot merges — only when nothing is lost", () => {
    const from = (over: Partial<Slot> = {}, children: Pick<Task, "status">[] = [{ status: "planned" }]): DragPayload => ({
      kind: "slot",
      slot: slot({ id: "s2", ...over }),
      children,
    });
    const into = { kind: "slot" as const, slot: slot() };

    it("merges a plain slot with work in it", () => {
      expect(gatherActFor(from(), into)).toBe("merge");
    });
    it("never merges a slot into itself", () => {
      expect(gatherActFor({ kind: "slot", slot: slot(), children: [{ status: "planned" }] }, into)).toBeNull();
    });
    it("won't merge an empty slot — that's deleting it by drop", () => {
      expect(gatherActFor(from({}, []), into)).toBeNull();
      expect(gatherActFor(from({}, [{ status: "trashed" }]), into)).toBeNull();
    });
    it("won't merge away a repeating slot's occurrence", () => {
      expect(gatherActFor(from({ recurrence_id: "r1" }), into)).toBeNull();
    });
    it("a repeating slot can still be the one that receives", () => {
      expect(gatherActFor(from(), { kind: "slot", slot: slot({ recurrence_id: "r1" }) })).toBe("merge");
    });
    it("won't merge one project's sitting into another's, or into a plain slot", () => {
      expect(gatherActFor(from({ project_id: "p1" }), { kind: "slot", slot: slot({ project_id: "p2" }) })).toBeNull();
      expect(gatherActFor(from({ project_id: "p1" }), into)).toBeNull();
    });
    it("merges two sittings of the same project", () => {
      expect(gatherActFor(from({ project_id: "p1" }), { kind: "slot", slot: slot({ project_id: "p1" }) })).toBe("merge");
    });
    it("a plain slot can merge into a sitting", () => {
      expect(gatherActFor(from(), { kind: "slot", slot: slot({ project_id: "p1" }) })).toBe("merge");
    });
  });
});

describe("slotMinutesFor — the block covers its contents, inside one day", () => {
  it("sums the pieces on the kernel's rule", () => {
    expect(slotMinutesFor([60, 30], new Date(2026, 9, 27, 9, 0))).toBe(90);
  });
  it("never shrinks a block that was sized by hand", () => {
    expect(slotMinutesFor([15], new Date(2026, 9, 27, 9, 0), 120)).toBe(120);
  });
  it("stops at midnight", () => {
    const late = new Date(2026, 9, 27, 23, 0);
    expect(minutesLeftInDay(late)).toBe(60);
    expect(slotMinutesFor([60, 60], late)).toBe(60);
  });
});

describe("resolveBlockDrop — the lit block wins", () => {
  const s = slot();
  const t = task({ id: "t9" });
  const find = (id: string) => (id === t.id ? t : undefined);
  const at = new Date(2026, 9, 27, 9, 30);

  it("joins or merges the slot under the pointer", () => {
    expect(resolveBlockDrop(at, { kind: "slot", id: "s1", act: "join" }, [s], find)).toEqual({ kind: "join", slot: s });
    expect(resolveBlockDrop(at, { kind: "slot", id: "s1", act: "merge" }, [s], find)).toEqual({ kind: "merge", slot: s });
  });
  it("combines with or is absorbed by the task under the pointer", () => {
    expect(resolveBlockDrop(at, { kind: "task", id: "t9", act: "combine" }, [s], find)).toEqual({ kind: "combine", task: t });
    expect(resolveBlockDrop(at, { kind: "task", id: "t9", act: "absorb" }, [s], find)).toEqual({ kind: "absorb", task: t });
  });
  it("beside is an answer — the time inside the slot doesn't join it", () => {
    expect(resolveBlockDrop(at, { kind: "slot", id: "s1", act: null }, [s], find)).toEqual({ kind: "beside" });
  });
  it("a target that vanished mid-drag lands the drop beside, not somewhere else", () => {
    expect(resolveBlockDrop(at, { kind: "slot", id: "gone", act: "join" }, [s], find)).toEqual({ kind: "beside" });
    expect(resolveBlockDrop(at, { kind: "task", id: "gone", act: "combine" }, [s], find)).toEqual({ kind: "beside" });
  });
  it("with no intent, a drop at a time inside a slot still joins it", () => {
    expect(resolveBlockDrop(at, null, [s], find)).toEqual({ kind: "join", slot: s });
    expect(resolveBlockDrop(new Date(2026, 9, 27, 11, 0), null, [s], find)).toBeNull();
  });
});

describe("planMakeSlot — ⌘G, the keyboard's twin of the drop", () => {
  const nine = new Date(2026, 9, 27, 9, 0).toISOString();
  const eleven = new Date(2026, 9, 27, 11, 0).toISOString();
  const none = () => [];

  it("makes one slot of two or more tasks, at the earliest of their times", () => {
    const plan = planMakeSlot({ tasks: [task({ id: "a", start_time: eleven }), task({ id: "b", start_time: nine })], slots: [] }, none);
    expect(plan.kind).toBe("create");
    if (plan.kind === "create") {
      expect(plan.start.toISOString()).toBe(nine);
      expect(plan.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    }
  });
  it("leaves finished tasks where they are", () => {
    const plan = planMakeSlot({ tasks: [task({ id: "a" }), task({ id: "b", status: "done" })], slots: [] }, none);
    expect(plan.kind).toBe("none");
  });
  it("puts tasks into the one slot selected with them", () => {
    const plan = planMakeSlot({ tasks: [task({ id: "a" })], slots: [slot()] }, none);
    expect(plan).toMatchObject({ kind: "gather", slot: { id: "s1" } });
  });
  it("merges two slots, the earlier receiving", () => {
    const early = slot({ id: "e", start_time: nine });
    const late = slot({ id: "l", start_time: eleven });
    const plan = planMakeSlot({ tasks: [], slots: [late, early] }, () => [task()]);
    expect(plan).toMatchObject({ kind: "merge", into: { id: "e" }, from: { id: "l" } });
  });
  it("merges the other way when the later one is the series", () => {
    const early = slot({ id: "e", start_time: nine });
    const late = slot({ id: "l", start_time: eleven, recurrence_id: "r" });
    const plan = planMakeSlot({ tasks: [], slots: [early, late] }, () => [task()]);
    expect(plan).toMatchObject({ kind: "merge", into: { id: "l" }, from: { id: "e" } });
  });
  it("says so when two slots can't merge either way", () => {
    const a = slot({ id: "a", project_id: "p1", start_time: nine });
    const b = slot({ id: "b", project_id: "p2", start_time: eleven });
    expect(planMakeSlot({ tasks: [], slots: [a, b] }, () => [task()]).kind).toBe("none");
  });
  it("says so for a lone task, or a mix it can't read", () => {
    expect(planMakeSlot({ tasks: [task()], slots: [] }, none).kind).toBe("none");
    expect(planMakeSlot({ tasks: [task()], slots: [slot({ id: "a" }), slot({ id: "b" })] }, none).kind).toBe("none");
  });
});
