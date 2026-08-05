// weekPlacement — "how much of what's left actually has a time THIS week."
// The row on the Week's Plan is built on this number, so the cases that matter
// are the ones where an honest answer differs from a naive one: work parked
// inside a slot (which carries no start_time of its own), and work that has a
// time in some OTHER week.

import { describe, expect, it } from "vitest";
import { isPlacedInWeek, pushState, upsertPushVerdict, weekPlacement } from "../src/lib/priorities";
import type { RockWork } from "../src/lib/priorities";
import type { VTask } from "../src/lib/vertical";
import type { BigRock } from "../src/lib/types";

function task(over: Partial<VTask> & { id: string }): VTask {
  return {
    id: over.id,
    projectId: "p1",
    initiativeId: null,
    domainId: null,
    keyResultId: null,
    bigRockId: null,
    title: over.id,
    energy: null,
    durationMins: 60,
    deadlineDaysAway: null,
    status: "ready",
    doDate: null,
    slotId: null,
    createdAt: null,
    completedAt: null,
    assignee: "me",
    rollCount: 0,
    ...over,
  } as VTask;
}

function work(tasks: VTask[]): RockWork {
  return {
    tasks,
    done: tasks.filter((t) => t.status === "done").length,
    total: tasks.length,
    scheduledMins: 0,
    pullable: [],
    label: null,
  };
}

describe("weekPlacement", () => {
  it("counts a task blocked inside this week as placed", () => {
    const w = work([task({ id: "a", durationMins: 90 })]);
    expect(weekPlacement(w, new Set(["a"]), new Set())).toEqual({ placedMins: 90, looseMins: 0, openCount: 1 });
  });

  it("counts work parked in a slot as placed — the slot holds the time", () => {
    // The whole reason `slots` is threaded into composeWeek: slot children carry
    // `start_time: null`, so they never appear in the blocks query and would
    // otherwise read as loose while sitting on Tuesday morning.
    const w = work([task({ id: "a", slotId: "s1", durationMins: 45 })]);
    expect(weekPlacement(w, new Set(), new Set(["s1"]))).toEqual({ placedMins: 45, looseMins: 0, openCount: 1 });
  });

  it("treats a time in ANOTHER week as loose — it is not happening here", () => {
    const w = work([task({ id: "a", slotId: "s-next-week", durationMins: 60 })]);
    expect(weekPlacement(w, new Set(), new Set(["s1"]))).toEqual({ placedMins: 0, looseMins: 60, openCount: 1 });
  });

  it("ignores finished work — the question is about what's LEFT", () => {
    const w = work([task({ id: "a", status: "done", durationMins: 120 }), task({ id: "b", durationMins: 30 })]);
    expect(weekPlacement(w, new Set(), new Set())).toEqual({ placedMins: 0, looseMins: 30, openCount: 1 });
  });

  it("splits a mixed project", () => {
    const w = work([
      task({ id: "a", durationMins: 60 }),
      task({ id: "b", slotId: "s1", durationMins: 30 }),
      task({ id: "c", durationMins: 90 }),
      task({ id: "d", status: "done", durationMins: 60 }),
    ]);
    expect(weekPlacement(w, new Set(["a"]), new Set(["s1"]))).toEqual({ placedMins: 90, looseMins: 90, openCount: 3 });
  });

  it("is silent on a project with nothing open", () => {
    const w = work([task({ id: "a", status: "done" })]);
    expect(weekPlacement(w, new Set(), new Set())).toEqual({ placedMins: 0, looseMins: 0, openCount: 0 });
  });
});

// The same predicate now answers two questions that must never diverge: how much
// is loose (the row's number) and WHICH tasks those are (the week crown's
// disclosure, and what "Find it time this week" hands the composer). A surface
// that listed three pieces under a row reading "2 loose" would make both liars.
describe("isPlacedInWeek — one rule for the count and the list", () => {
  const blocked = new Set(["a"]);
  const weekSlots = new Set(["s1"]);

  it("agrees with weekPlacement on every case it scores", () => {
    const tasks = [
      task({ id: "a", durationMins: 90 }),                       // own block this week
      task({ id: "b", slotId: "s1", durationMins: 45 }),         // parked in a sitting
      task({ id: "c", slotId: "s-next-week", durationMins: 60 }), // timed elsewhere
      task({ id: "d", durationMins: 30 }),                       // nothing at all
    ];
    const loose = tasks.filter((t) => !isPlacedInWeek(t.id, t.slotId, blocked, weekSlots));
    const counted = weekPlacement(work(tasks), blocked, weekSlots);

    expect(loose.map((t) => t.id)).toEqual(["c", "d"]);
    // the list and the number describe the same set of minutes
    expect(loose.reduce((s, t) => s + t.durationMins, 0)).toBe(counted.looseMins);
  });

  it("treats a null slot as unplaced rather than matching a null slot id", () => {
    expect(isPlacedInWeek("z", null, new Set(), weekSlots)).toBe(false);
    expect(isPlacedInWeek("z", undefined, new Set(), weekSlots)).toBe(false);
  });
});

describe("pushState", () => {
  it("ranks shipped above a week verdict", () => {
    expect(pushState({ shipped: true, doneAt: null, done: 0, total: 5 })).toBe("shipped");
    expect(pushState({ shipped: false, doneAt: "2026-07-29", done: 1, total: 5 })).toBe("landed");
  });

  it("invites a ship only when every task is done", () => {
    expect(pushState({ shipped: false, doneAt: null, done: 5, total: 5 })).toBe("ready-to-ship");
    expect(pushState({ shipped: false, doneAt: null, done: 4, total: 5 })).toBe("in-motion");
    // No tasks at all is not "everything is done" — it's an empty project.
    expect(pushState({ shipped: false, doneAt: null, done: 0, total: 0 })).toBe("in-motion");
  });
});

describe("upsertPushVerdict", () => {
  const proj = { id: "p1", name: "Stampede v3", outcome: "handed off" };
  const rock = (over: Partial<BigRock> = {}): BigRock => ({
    id: "r1",
    title: "Stampede v3",
    win: "",
    initiative_id: null,
    project_id: "p1",
    done_at: null,
    roll_count: 0,
    ...over,
  });

  it("mints a verdict record on first landing", () => {
    const next = upsertPushVerdict([], proj, true, "2026-07-30T00:00:00Z");
    expect(next).toHaveLength(1);
    expect(next[0].project_id).toBe("p1");
    expect(next[0].done_at).toBe("2026-07-30T00:00:00Z");
  });

  it("clears an existing verdict without dropping the record", () => {
    const next = upsertPushVerdict([rock({ done_at: "2026-07-29T00:00:00Z" })], proj, false, "x");
    expect(next).toHaveLength(1);
    expect(next[0].done_at).toBeNull();
  });

  it("is a no-op when clearing a verdict that was never cast", () => {
    const rocks: BigRock[] = [];
    expect(upsertPushVerdict(rocks, proj, false, "x")).toBe(rocks);
  });

  it("leaves other projects' verdicts alone", () => {
    const other = rock({ id: "r2", project_id: "p2", done_at: "2026-07-28T00:00:00Z" });
    const next = upsertPushVerdict([other], proj, true, "2026-07-30T00:00:00Z");
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(other);
  });
});
