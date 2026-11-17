// Focus (D-242) — what a focus holds, what ⌘. picks, and the line it says.
import { describe, expect, it } from "vitest";
import { blockOnNow, blocksAhead, dayBlocks, readFocus, sameTarget, thenAfter } from "../src/lib/focus";
import { focusLine } from "../src/components/focus/FocusPanel";
import type { BusyBlock } from "../src/lib/now";
import type { Slot, Task } from "../src/lib/types";

const when = (h: number, m = 0) => new Date(2026, 10, 17, h, m);
const at = (h: number, m = 0) => when(h, m).toISOString();

const slot = (id: string, h: number, over: Partial<Slot> = {}): Slot => ({
  id,
  user_id: "u",
  created_at: "",
  updated_at: "",
  title: id,
  do_date: "2026-11-17",
  start_time: at(h),
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

const task = (id: string, h: number | null, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    status: "planned",
    start_time: h == null ? null : at(h),
    duration_minutes: 30,
    slot_id: null,
    sort_order: 0,
    completed_at: null,
    ...over,
  }) as Task;

const busy = (title: string, h: number, kind: BusyBlock["kind"] = "event"): BusyBlock => ({
  title,
  start: when(h),
  end: when(h + 1),
  kind,
});

// A morning: an 8–9am slot with three tasks, a lone 10am task, an empty slot.
const morning = slot("Morning Focus", 8);
const empty = slot("Held", 13);
const a = task("a", 8, { slot_id: "Morning Focus", sort_order: 1 });
const b = task("b", 8, { slot_id: "Morning Focus", sort_order: 2 });
const c = task("c", 8, { slot_id: "Morning Focus", sort_order: 3 });
const call = task("call", 10);
const loose = task("loose", null);
const today = [c, a, b, call, loose];

describe("dayBlocks / blockOnNow", () => {
  const blocks = dayBlocks(today, [morning, empty]);

  it("lists each slot with work and each lone timed task, in time order — never an empty slot", () => {
    expect(blocks.map((x) => x.title)).toEqual(["Morning Focus", "call"]);
    expect(blocks[0].open).toBe(3);
  });

  it("⌘. answers with the block on the clock now", () => {
    expect(blockOnNow(blocks, when(8, 20))?.title).toBe("Morning Focus");
    expect(blockOnNow(blocks, when(10, 10))?.title).toBe("call");
  });

  it("and with nothing between blocks — the rail asks instead of guessing", () => {
    expect(blockOnNow(blocks, when(9, 30))).toBeNull();
    expect(blockOnNow(blocks, when(7))).toBeNull();
  });

  it("a block with nothing left is not on the clock", () => {
    const done = dayBlocks(
      [a, b, c].map((t) => ({ ...t, status: "done" as const })),
      [morning],
    );
    expect(blockOnNow(done, when(8, 20))).toBeNull();
  });

  it("when two overlap, the one you just stepped into", () => {
    const inner = task("standup", 8, { start_time: at(8, 30), duration_minutes: 15 });
    expect(blockOnNow(dayBlocks([...today, inner], [morning]), when(8, 35))?.title).toBe("standup");
  });

  it("the picker offers what's ahead, not what's over", () => {
    expect(blocksAhead(blocks, when(9, 30)).map((x) => x.title)).toEqual(["call"]);
  });
});

describe("readFocus", () => {
  it("a slot holds its tasks in its own order, done ones in place", () => {
    const done = { ...b, status: "done" as const, completed_at: at(8, 40) };
    const r = readFocus({ kind: "slot", slotId: "Morning Focus" }, [c, a, done, call], [morning])!;
    expect(r.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect([r.done, r.total, r.closed]).toEqual([1, 3, false]);
    expect(r.end?.getTime()).toBe(when(9).getTime());
  });

  it("closes when the last one is done, at the time the last one was", () => {
    const all = [a, b, c].map((t, i) => ({ ...t, status: "done" as const, completed_at: at(8, 10 + i * 10) }));
    const r = readFocus({ kind: "slot", slotId: "Morning Focus" }, all, [morning])!;
    expect(r.closed).toBe(true);
    expect(r.closedAt?.getTime()).toBe(when(8, 30).getTime());
  });

  it("a picked set keeps your order and has no time of its own", () => {
    const r = readFocus({ kind: "set", taskIds: ["loose", "call"] }, today, [])!;
    expect(r.tasks.map((t) => t.id)).toEqual(["loose", "call"]);
    expect(r.start).toBeNull();
  });

  it("a target that's gone reads as nothing — the rail asks again", () => {
    expect(readFocus({ kind: "slot", slotId: "nope" }, today, [morning])).toBeNull();
    expect(readFocus({ kind: "set", taskIds: ["x"] }, today, [])).toBeNull();
    expect(readFocus({ kind: "task", taskId: "call" }, [{ ...call, status: "trashed" as const }], [])).toBeNull();
  });

  it("works on an empty slot (P7) — nothing in it, never closed", () => {
    const r = readFocus({ kind: "slot", slotId: "Held" }, today, [empty])!;
    expect([r.total, r.closed]).toEqual([0, false]);
  });
});

describe("thenAfter + focusLine", () => {
  const r = readFocus({ kind: "slot", slotId: "Morning Focus" }, today, [morning])!;

  it("then is the first busy thing after the block ends, not inside it", () => {
    const then = thenAfter(r, [busy("inside", 8), busy("Stand-up", 9), busy("Lunch", 12)], when(8, 20));
    expect(then?.title).toBe("Stand-up");
  });

  it("says time left and what's next while it runs", () => {
    expect(focusLine(r, busy("Stand-up", 9), when(8, 22))).toBe("38m left · then Stand-up at 9am");
  });

  it("says when it starts before it has", () => {
    expect(focusLine(r, null, when(7, 30))).toBe("Starts 8am");
  });

  it("closed, it says when — and the time you got back", () => {
    const all = [a, b, c].map((t) => ({ ...t, status: "done" as const, completed_at: at(8, 48) }));
    const closed = readFocus({ kind: "slot", slotId: "Morning Focus" }, all, [morning])!;
    expect(focusLine(closed, null, when(8, 50))).toBe("Cleared at 8:48am. 12m to spare.");
  });
});

describe("sameTarget", () => {
  it("a focus started twice is the same focus", () => {
    expect(sameTarget({ kind: "set", taskIds: ["a", "b"] }, { kind: "set", taskIds: ["a", "b"] })).toBe(true);
    expect(sameTarget({ kind: "slot", slotId: "x" }, { kind: "task", taskId: "x" })).toBe(false);
  });
});
