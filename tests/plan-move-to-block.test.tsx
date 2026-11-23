// @vitest-environment jsdom
/**
 * A group Plan the week built is a proposal, and a proposal you can't correct is
 * a decision made for you (P3). The v2 rail lost the one correction the old walk
 * had, so a task could only be taken or left with its whole group (D-253).
 * `moveToBlock` puts a loose task into ANOTHER block; `leaveOut` takes it off the
 * week — driven through the real hook over a mocked store, like the commit tests.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildVertical } from "../src/lib/vertical";
import type { Task } from "../src/lib/types";

const NEXT_WEEK = "2026-11-16";
const task = (id: string, title: string, extra: Partial<Task> = {}) =>
  ({
    id, title, status: "inbox", project_id: null, initiative_id: null, domain_id: null, do_date: null, start_time: null,
    sprint_id: null, slot_id: null, recurrence_id: null, duration_minutes: 30, deadline: null, sort_order: 0, completed_at: null, energy: null,
    ...extra,
  }) as unknown as Task;

// two runs of shallow work: calls, and replies (grouped by what you'd be DOING)
const ALL = [
  task("c1", "Call Sam about the quote"),
  task("c2", "Call Ann about the lease"),
  task("r1", "Reply to Bo"),
  task("r2", "Reply to Cy"),
  task("p1", "Draft the memo", { project_id: "proj" }),
];

const store = { data: buildVertical([], [], [], ALL, null, new Date("2026-11-14T00:50:00.000Z")), planWeek: vi.fn(), applySlots: vi.fn(), assignToStanding: vi.fn(), unplanTask: vi.fn() };
vi.mock("../src/hooks/useVertical", () => ({ useVertical: () => store }));
vi.mock("../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: { work_start_minutes: 480, work_end_minutes: 990 }, update: vi.fn() }) }));
vi.mock("../src/hooks/useWorkingDays", () => ({ useWorkingDays: () => [[1, 2, 3, 4, 5], vi.fn()] }));
vi.mock("../src/hooks/useCalendar", () => ({ useExternalEvents: () => ({ data: [] }) }));
vi.mock("../src/hooks/useSlots", () => ({
  useSlotMutations: () => ({ updateSlot: vi.fn(), removeSlot: vi.fn() }),
  useSlots: () => ({ data: [] }),
  useSlotTasks: () => ({ data: [] }),
}));
vi.mock("../src/hooks/useTasks", () => ({
  useAllTasks: () => ({ data: ALL }),
  useScheduledTasks: () => ({ data: [] }),
  useTaskMutations: () => ({ patchTask: vi.fn() }),
}));
vi.mock("../src/lib/supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { useWeekDraft } from "../src/hooks/useWeekDraft";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T00:50:00.000Z"));
});

async function draft() {
  const hook = renderHook(() => useWeekDraft({ autoTheme: false, weekStartISO: NEXT_WEEK }));
  act(() => hook.result.current.setKept(new Set(ALL.map((t) => t.id))));
  await waitFor(() => expect(hook.result.current.runs.length).toBe(2));
  return hook;
}
const blockOf = (h: Awaited<ReturnType<typeof draft>>, id: string) => [...h.result.current.slotById.values()].find((b) => b.taskIds.includes(id));

describe("moveToBlock — a loose task goes into another block", () => {
  it("the target gains it, the source loses it, and the gained block says so", async () => {
    const h = await draft();
    const from = blockOf(h, "c1")!;
    const to = blockOf(h, "r1")!;
    expect(from.id).not.toBe(to.id);
    let moved = false;
    act(() => {
      moved = h.result.current.moveToBlock("c1", to.id);
    });
    expect(moved).toBe(true);
    await waitFor(() => expect(blockOf(h, "c1")?.taskIds.sort()).toEqual(["c1", "r1", "r2"]));
    // the block it left was a pair: one task left is no longer a block, it places on its own
    expect(h.result.current.runs.flatMap((r) => r.taskIds)).not.toContain("c2");
    expect(blockOf(h, "c2")).toBeUndefined();
    // the length follows the members
    expect(blockOf(h, "c1")!.durationMins).toBe(90);
  });

  it("keeps every task in exactly one place", async () => {
    const h = await draft();
    const to = blockOf(h, "r1")!;
    act(() => void h.result.current.moveToBlock("c1", to.id));
    await waitFor(() => expect(blockOf(h, "c1")?.taskIds).toContain("r1"));
    const all = [...h.result.current.slotById.values()].flatMap((b) => b.taskIds);
    expect(all.filter((id) => id === "c1")).toHaveLength(1);
  });

  it("refuses project work (it stays with its sitting), a missing block, and its own block", async () => {
    const h = await draft();
    const to = blockOf(h, "r1")!;
    const own = blockOf(h, "c1")!;
    let a = true, b = true, c = true;
    act(() => {
      a = h.result.current.moveToBlock("p1", to.id);
      b = h.result.current.moveToBlock("c1", "nowhere");
      c = h.result.current.moveToBlock("c1", own.id);
    });
    expect([a, b, c]).toEqual([false, false, false]);
  });

  it("a second move into a block it already built keeps one block, not two", async () => {
    const h = await draft();
    const to = blockOf(h, "r1")!;
    act(() => void h.result.current.moveToBlock("c1", to.id));
    await waitFor(() => expect(blockOf(h, "c1")?.taskIds).toContain("r1"));
    const built = blockOf(h, "c1")!;
    act(() => void h.result.current.moveToBlock("c2", built.id));
    await waitFor(() => expect(blockOf(h, "c2")?.taskIds.sort()).toEqual(["c1", "c2", "r1", "r2"]));
    expect(h.result.current.runs).toHaveLength(1);
  });

  it("undo puts the group back", async () => {
    const h = await draft();
    const to = blockOf(h, "r1")!;
    act(() => {
      h.result.current.remember();
      h.result.current.moveToBlock("c1", to.id);
    });
    await waitFor(() => expect(blockOf(h, "c1")?.taskIds).toContain("r1"));
    act(() => void h.result.current.undo());
    await waitFor(() => expect(blockOf(h, "c1")?.taskIds).not.toContain("r1"));
  });
});

describe("leaveOut — off the week, never re-offered", () => {
  it("takes the task out of the draft and keeps the rest", async () => {
    const h = await draft();
    act(() => h.result.current.leaveOut("r1"));
    await waitFor(() => expect(h.result.current.kept.has("r1")).toBe(false));
    expect(h.result.current.kept.has("r2")).toBe(true);
    expect([...h.result.current.slotById.values()].flatMap((b) => b.taskIds)).not.toContain("r1");
  });
});
