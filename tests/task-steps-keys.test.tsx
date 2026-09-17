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
  const Box = forwardRef<unknown, { onArrowUp?: () => void; onLeave?: () => void }>(function Box({ onArrowUp, onLeave }, ref) {
    const el = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => el.current?.focus() }));
    return (
      <input
        ref={el}
        aria-label="Add a step"
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") onArrowUp?.();
          if (e.key === "Escape") onLeave?.();
        }}
      />
    );
  });
  return { default: Box };
});

const { default: TaskSteps } = await import("../src/components/TaskSteps");

function setup(props: { keyboardEntry?: boolean } = {}) {
  const mutations = {
    addStep: vi.fn(),
    toggleStep: vi.fn(),
    renameStep: vi.fn(),
    removeStep: vi.fn(),
    reorder: vi.fn(),
  };
  const view = render(
    <TaskSteps task={{ id: "t" } as Task} mutations={mutations as never} {...props} />,
  );
  const rows = view.getAllByLabelText("Step") as HTMLInputElement[];
  const box = view.getByLabelText("Add a step");
  const list = view.getByLabelText("Steps");
  const current = () =>
    (list.querySelector("[aria-current=true] input") as HTMLInputElement | null)?.value;
  return { mutations, rows, box, list, current };
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

  it("Esc from a field rests on the list — which still speaks the grammar", () => {
    const { mutations, rows, list, current } = setup();
    act(() => rows[1]!.focus());
    fireEvent.change(rows[1]!, { target: { value: "" } });
    fireEvent.keyDown(rows[1]!, { key: "Escape" });
    expect(document.activeElement).toBe(list);
    // The abandoned (emptied) edit neither renamed nor removed the step.
    expect(mutations.removeStep).not.toHaveBeenCalled();
    expect(mutations.renameStep).not.toHaveBeenCalled();
    expect(current()).toBe("Two");
    fireEvent.keyDown(list, { key: "k" });
    expect(current()).toBe("One");
    fireEvent.keyDown(list, { key: "e" });
    expect(mutations.toggleStep).toHaveBeenCalledWith(STEPS[0]);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("a second Esc falls through to the surface around it", () => {
    const { rows, list } = setup();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    act(() => rows[0]!.focus());
    fireEvent.keyDown(rows[0]!, { key: "Escape" });
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(list, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", outer);
  });

  it("the add box's Esc rests on the last step; ↓ from nothing enters the list", () => {
    const { box, list, current } = setup({ keyboardEntry: true });
    act(() => box.focus());
    fireEvent.keyDown(box, { key: "Escape" });
    expect(document.activeElement).toBe(list);
    expect(current()).toBe("Two");
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).toBe(list);
    expect(current()).toBe("One");
  });
});
