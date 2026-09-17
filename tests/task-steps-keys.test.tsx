// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../src/lib/types";

const STEPS = [
  { id: "a", title: "One", sort_order: 0, status: "backlog" },
  { id: "b", title: "Two", sort_order: 1, status: "backlog" },
] as Task[];

vi.mock("../src/hooks/useTasks", () => ({
  useTaskSteps: () => ({ data: STEPS }),
}));
vi.mock("../src/components/tasks/TaskComposer", async () => {
  const { forwardRef, useImperativeHandle, useRef } = await import("react");
  const Box = forwardRef<unknown, { onArrowUp?: () => void }>(function Box({ onArrowUp }, ref) {
    const el = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => el.current?.focus() }));
    return (
      <input
        ref={el}
        aria-label="Add a step"
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") onArrowUp?.();
        }}
      />
    );
  });
  return { default: Box };
});

const { default: TaskSteps } = await import("../src/components/TaskSteps");

function setup() {
  const mutations = {
    addStep: vi.fn(),
    toggleStep: vi.fn(),
    renameStep: vi.fn(),
    removeStep: vi.fn(),
    reorder: vi.fn(),
  };
  const view = render(
    <TaskSteps task={{ id: "t" } as Task} mutations={mutations as never} />,
  );
  const rows = view.getAllByLabelText("Step") as HTMLInputElement[];
  const box = view.getByLabelText("Add a step");
  return { mutations, rows, box };
}

describe("TaskSteps — the list grammar inside a checklist", () => {
  it("↑ / ↓ walk the steps and the add box", () => {
    const { rows, box } = setup();
    act(() => box.focus());
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    fireEvent.keyDown(rows[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(box);
  });

  it("Enter steps down; ⌘↵ ticks; ⌥↓ moves", () => {
    const { mutations, rows } = setup();
    act(() => rows[0]!.focus());
    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: "Enter", metaKey: true });
    expect(mutations.toggleStep).toHaveBeenCalledWith(STEPS[1]);
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown", altKey: true });
    expect(mutations.reorder).toHaveBeenCalledWith(STEPS, ["b", "a"]);
  });

  it("⌫ on an emptied step removes it and lands on the one above", () => {
    const { mutations, rows } = setup();
    act(() => rows[1]!.focus());
    fireEvent.change(rows[1]!, { target: { value: "" } });
    fireEvent.keyDown(rows[1]!, { key: "Backspace" });
    expect(document.activeElement).toBe(rows[0]);
    expect(mutations.removeStep).toHaveBeenCalledWith(STEPS[1]);
  });
});
