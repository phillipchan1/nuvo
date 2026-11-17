// @vitest-environment jsdom
// Unschedule (D-248) — "other priorities came up, clear the afternoon".
// Pinned: what it says, what it moves, and that it is one key in every list.
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { isUnschedulable, unscheduleDestination, unscheduleSummary } from "../src/lib/unschedule";
import { useTaskListKeys } from "../src/components/tasks/useTaskListKeys";
import { useUnschedule } from "../src/hooks/useUnschedule";
import type { Slot, Task } from "../src/lib/types";

const recorded: { undo: () => void; label: string }[] = [];
vi.mock("../src/hooks/useUndoStack", () => ({
  useOptionalUndoStack: () => ({ recordUndo: (e: { undo: () => void; label: string }) => recorded.push(e) }),
}));
vi.mock("sonner", () => ({ toast: vi.fn() }));

const t = (over: Partial<Task> = {}) =>
  ({ id: "x", title: "X", status: "planned", do_date: "2026-11-17", start_time: null, slot_id: null, project_id: null, ...over }) as Task;

describe("what can be unscheduled", () => {
  it("anything with a day, a time or a slot — never done or trashed work", () => {
    expect(isUnschedulable(t())).toBe(true);
    expect(isUnschedulable(t({ do_date: null, slot_id: "s" }))).toBe(true);
    expect(isUnschedulable(t({ do_date: null, status: "inbox" }))).toBe(false);
    expect(isUnschedulable(t({ status: "done" }))).toBe(false);
    expect(isUnschedulable(t({ status: "trashed" }))).toBe(false);
  });
});

describe("it names where the work went (D-063a)", () => {
  it("loose work to the Inbox, project work to its project — by name when known", () => {
    expect(unscheduleDestination(t())).toBe("Inbox");
    expect(unscheduleDestination(t({ project_id: "p" }))).toBe("its project");
    expect(unscheduleDestination(t({ project_id: "p" }), () => "Stampede v3")).toBe("Stampede v3");
  });

  it("one line: the count, the destination, and what was left alone", () => {
    expect(unscheduleSummary(["Inbox"])).toBe("Unscheduled — back to Inbox");
    expect(unscheduleSummary(["Inbox", "Inbox"])).toBe("Unscheduled 2 — back to Inbox");
    expect(unscheduleSummary(["Inbox", "Stampede v3"])).toBe("Unscheduled 2 — each back where it came from");
    expect(unscheduleSummary(["Inbox", "Inbox", "Inbox"], { events: 3, slots: 1 }, 2)).toBe(
      "Unscheduled 3 — back to Inbox · 2 slots cleared · 1 repeating slot kept · 3 events left alone",
    );
  });

  it("a slot is time on the calendar too — an empty one just clears", () => {
    expect(unscheduleSummary([], {}, 1)).toBe("Cleared 1 slot");
    expect(unscheduleSummary([], { events: 1 }, 2)).toBe("Cleared 2 slots · 1 event left alone");
  });

  it("a selection of only meetings says so rather than doing nothing silently", () => {
    expect(unscheduleSummary([], { events: 2 })).toBe("Nothing to unschedule · 2 events left alone");
  });
});

describe("u is Unschedule in every task list", () => {
  const ROWS = [t({ id: "a" }), t({ id: "b" }), t({ id: "c" })];
  function setup(withAct = true) {
    const unschedule = vi.fn();
    const acts = {
      open: vi.fn(), complete: vi.fn(), trash: vi.fn(), rename: vi.fn(),
      ...(withAct ? { unschedule } : {}),
    };
    const hook = renderHook(() => {
      const [cursorId, setCursorId] = useState<string | null>(null);
      const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
      useTaskListKeys({ enabled: true, rows: ROWS, cursor: { cursorId, setCursorId, selectedIds, setSelectedIds }, acts });
      return { selectedIds };
    });
    const press = (key: string) => {
      const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => { window.dispatchEvent(e); });
      return e;
    };
    return { unschedule, hook, press };
  }

  it("hits the whole selection, then lets it go", () => {
    const { unschedule, hook, press } = setup();
    press("j"); press("x"); press("j"); press("x");
    press("u");
    expect(unschedule).toHaveBeenCalledWith([ROWS[0], ROWS[1]]);
    expect(hook.result.current.selectedIds.size).toBe(0);
  });

  it("falls through where the list has no calendar to leave", () => {
    const { press } = setup(false);
    press("j");
    expect(press("u").defaultPrevented).toBe(false);
  });
});

describe("a slot unschedules too", () => {
  const slot = (over: Partial<Slot> = {}) =>
    ({ id: "s1", title: "Frontier admin", do_date: "2026-11-17", start_time: "2026-11-17T17:00:00Z",
       duration_minutes: 60, project_id: null, domain_id: null, color: null, recurrence_id: null, ...over }) as Slot;

  function run(slots: { slot: Slot; children: Task[] }[]) {
    recorded.length = 0;
    const mutations = { backToInbox: vi.fn(), patchTask: vi.fn() };
    const slotMutations = { removeSlot: vi.fn(), createSlot: vi.fn() };
    const { result } = renderHook(() => useUnschedule(mutations as never, slotMutations as never));
    act(() => result.current([], {}, slots));
    return { mutations, slotMutations };
  }

  it("a one-off slot comes off and its tasks go back — one undo puts both back, slot first", () => {
    const kids = [t({ id: "a", slot_id: "s1" }), t({ id: "b", slot_id: "s1" })];
    const { mutations, slotMutations } = run([{ slot: slot(), children: kids }]);
    expect(mutations.backToInbox).toHaveBeenCalledTimes(2);
    expect(slotMutations.removeSlot).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    expect(recorded).toHaveLength(1);
    expect(recorded[0].label).toBe("Unscheduled 2 — back to Inbox · 1 slot cleared");
    recorded[0].undo();
    expect(slotMutations.createSlot).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    expect(slotMutations.createSlot.mock.invocationCallOrder[0]).toBeLessThan(mutations.patchTask.mock.invocationCallOrder[0]);
  });

  it("a repeating slot keeps its place — only its tasks come off", () => {
    const { mutations, slotMutations } = run([{ slot: slot({ recurrence_id: "r" }), children: [t({ id: "a", slot_id: "s1" })] }]);
    expect(mutations.backToInbox).toHaveBeenCalledTimes(1);
    expect(slotMutations.removeSlot).not.toHaveBeenCalled();
    expect(recorded[0].label).toBe("Unscheduled — back to Inbox · 1 repeating slot kept");
  });
});
