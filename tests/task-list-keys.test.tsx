// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { orderBeside, useTaskListKeys, type TaskListKeyActs } from "../src/components/tasks/useTaskListKeys";
import type { Task } from "../src/lib/types";

const task = (id: string, sort_order: number, status: Task["status"] = "planned") =>
  ({ id, title: id.toUpperCase(), sort_order, status }) as Task;
const ROWS = [task("a", 1), task("b", 2), task("c", 3)];

function setup(extra?: TaskListKeyActs["extra"]) {
  const acts = {
    open: vi.fn(),
    complete: vi.fn(),
    trash: vi.fn(),
    date: vi.fn(),
    move: vi.fn(),
    priority: vi.fn(),
    rename: vi.fn(),
    reorderBy: vi.fn(),
    add: vi.fn(),
    extra,
  };
  const hook = renderHook(() => {
    const [cursorId, setCursorId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    useTaskListKeys({ enabled: true, rows: ROWS, cursor: { cursorId, setCursorId, selectedIds, setSelectedIds }, acts });
    return { cursorId, selectedIds };
  });
  const press = (key: string, opts: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
    act(() => {
      window.dispatchEvent(e);
    });
    return e;
  };
  return { acts, hook, press };
}

describe("useTaskListKeys — one grammar for every task list", () => {
  it("j / k walk the cursor, clamped", () => {
    const { hook, press } = setup();
    press("j");
    expect(hook.result.current.cursorId).toBe("a");
    press("j");
    press("j");
    press("j");
    expect(hook.result.current.cursorId).toBe("c");
    press("k");
    expect(hook.result.current.cursorId).toBe("b");
  });

  it("e completes the cursor row and steps down", () => {
    const { acts, hook, press } = setup();
    press("j");
    press("e");
    expect(acts.complete).toHaveBeenCalledWith([ROWS[0]]);
    expect(hook.result.current.cursorId).toBe("b");
  });

  it("x builds a selection that every act then hits", () => {
    const { acts, hook, press } = setup();
    press("j");
    press("x");
    press("j");
    press("x");
    expect([...hook.result.current.selectedIds]).toEqual(["a", "b"]);
    press("t");
    expect(acts.date).toHaveBeenCalledWith([ROWS[0], ROWS[1]]);
    press("2");
    expect(acts.priority).toHaveBeenCalledWith([ROWS[0], ROWS[1]], "medium");
    press("e");
    expect(acts.complete).toHaveBeenCalledWith([ROWS[0], ROWS[1]]);
    expect(hook.result.current.selectedIds.size).toBe(0);
  });

  it("⌫ trashes and hands the cursor to the next row", () => {
    const { acts, hook, press } = setup();
    press("j");
    press("Backspace");
    expect(acts.trash).toHaveBeenCalledWith([ROWS[0]]);
    expect(hook.result.current.cursorId).toBe("b");
  });

  it("⌥↑↓ reorders, ⌘E renames, ↵ opens, a / ⇧A add beside", () => {
    const { acts, press } = setup();
    press("j");
    press("ArrowDown", { altKey: true });
    expect(acts.reorderBy).toHaveBeenCalledWith(ROWS[0], 1);
    press("e", { metaKey: true });
    expect(acts.rename).toHaveBeenCalledWith(ROWS[0]);
    press("Enter");
    expect(acts.open).toHaveBeenCalledWith(ROWS[0]);
    press("a");
    expect(acts.add).toHaveBeenLastCalledWith(ROWS[0], "below");
    press("A", { shiftKey: true });
    expect(acts.add).toHaveBeenLastCalledWith(ROWS[0], "above");
  });

  it("marks what it handles, so app-wide letters stand aside — and leaves the rest", () => {
    const { press } = setup();
    expect(press("1").defaultPrevented).toBe(false); // no row: the tab switcher's
    press("j");
    expect(press("1").defaultPrevented).toBe(true); // a row: its priority
    expect(press("s").defaultPrevented).toBe(false); // the Schedule's
  });

  it("Escape clears the selection, then the cursor, then lets go", () => {
    const { hook, press } = setup();
    press("j");
    press("x");
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(hook.result.current.selectedIds.size).toBe(0);
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(hook.result.current.cursorId).toBeNull();
    expect(press("Escape").defaultPrevented).toBe(false);
  });

  it("ignores keys typed into a field", () => {
    const { acts } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    });
    expect(acts.complete).not.toHaveBeenCalled();
    input.remove();
  });

  it("host keys run first", () => {
    const extra = vi.fn((e: KeyboardEvent) => e.key === "n");
    const { press } = setup(extra);
    expect(press("n").defaultPrevented).toBe(true);
    expect(extra).toHaveBeenCalled();
  });
});

describe("orderBeside", () => {
  it("lands between the anchor and its neighbour", () => {
    expect(orderBeside(ROWS, ROWS[0], "below")).toBe(1.5);
    expect(orderBeside(ROWS, ROWS[1], "above")).toBe(1.5);
    expect(orderBeside(ROWS, ROWS[2], "below")).toBe(4);
    expect(orderBeside(ROWS, null, "below")).toBeUndefined();
  });
});
