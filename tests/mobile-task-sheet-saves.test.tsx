// @vitest-environment jsdom
/**
 * The phone's task sheet built derived records from the render's `task` — a
 * frame behind the title it had just committed. "Make it an event" created the
 * event under the OLD name (and trashed the renamed task); Duplicate copied the
 * old name. And a step typed but not entered was lost on ✕: nothing blurred it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../src/lib/types";

const taskToEvent = vi.fn(async () => true);
vi.mock("../src/hooks/useTaskToEvent", () => ({ useTaskToEvent: () => taskToEvent }));
vi.mock("../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("../src/hooks/useRecurrence", () => ({
  useRecurrences: () => ({ data: [] }),
  useRecurrenceMutations: () => ({}),
}));
vi.mock("../src/hooks/useSlots", () => ({
  useSlots: () => ({ data: [] }),
  useSlotTasks: () => ({ data: [] }),
}));
vi.mock("../src/hooks/useTasks", () => ({ useScheduledTasks: () => ({ data: [] }) }));
vi.mock("../src/components/ReminderSelect", () => ({ default: () => null }));
// The steps list stands in as one blur-only add box — what TaskSteps' composer
// (submitOnBlur) and a step mid-rename both are.
const stepSaved = vi.fn();
vi.mock("../src/components/TaskSteps", () => ({
  default: () => <input aria-label="Add a step" onBlur={(e) => e.target.value && stepSaved(e.target.value)} />,
}));

import MobileTaskSheet from "../src/components/mobile/MobileTaskSheet";

const task = {
  id: "t1",
  title: "Old title",
  notes: "",
  status: "todo",
  priority: "none",
  do_date: "2026-11-16",
  start_time: "2026-11-16T17:00:00.000Z",
  duration_minutes: 30,
  project_id: null,
  initiative_id: null,
  domain_id: null,
  slot_id: null,
  sprint_id: null,
  recurrence_id: null,
  deadline: null,
  task_labels: [],
} as unknown as Task;

const vertical = { domains: [], projects: [], initiatives: [], sprint: null } as never;

function setup() {
  const mutations = {
    patchTask: vi.fn(),
    create: vi.fn(async () => undefined),
    trash: vi.fn(),
    backToInbox: vi.fn(),
  };
  const onClose = vi.fn();
  render(
    <MobileTaskSheet
      task={task}
      labels={[]}
      vertical={vertical}
      mutations={mutations as never}
      slotMutations={{} as never}
      onClose={onClose}
    />,
  );
  const title = screen.getByLabelText("Task title");
  title.focus();
  fireEvent.change(title, { target: { value: "New title" } });
  return { mutations, onClose };
}

describe("MobileTaskSheet acts read the task as it stands now", () => {
  beforeEach(() => {
    taskToEvent.mockClear();
    stepSaved.mockClear();
  });

  it("Make it an event uses the title just typed", () => {
    const { mutations, onClose } = setup();
    fireEvent.click(screen.getByText("Make it an event"));
    expect(mutations.patchTask).toHaveBeenCalledWith("t1", { title: "New title" });
    expect(mutations.patchTask).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    expect(taskToEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", title: "New title" }));
  });

  it("Duplicate copies the title just typed", () => {
    const { mutations } = setup();
    fireEvent.click(screen.getByText("Duplicate"));
    expect(mutations.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New title" }),
      expect.objectContaining({ label: "Duplicated — New title" }),
    );
  });

  it("closing flushes a step typed but not entered — and the title once", () => {
    const { mutations, onClose } = setup();
    const step = screen.getByLabelText("Add a step");
    step.focus(); // blurs the title: its own save
    fireEvent.change(step, { target: { value: "Call the venue" } });
    // ✕ never takes focus on iOS; the step field is still focused.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stepSaved).toHaveBeenCalledWith("Call the venue");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutations.patchTask).toHaveBeenCalledTimes(1);
  });

  it("an act that closes the sheet (a Plan chip) flushes the step too", () => {
    const { mutations, onClose } = setup();
    const step = screen.getByLabelText("Add a step");
    step.focus();
    fireEvent.change(step, { target: { value: "Book the room" } });
    fireEvent.click(screen.getByText("Inbox"));
    expect(mutations.backToInbox).toHaveBeenCalled();
    expect(stepSaved).toHaveBeenCalledWith("Book the room");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
