import { describe, expect, it } from "vitest";
import { taskPopoverSelection } from "../src/components/LeftRail";

describe("task popover rail selection", () => {
  it("keeps the opening row selected while its popover is active", () => {
    expect(taskPopoverSelection("task-1", "task-1", "task-1")).toEqual({
      selectedId: "task-1",
      openedFromRailId: "task-1",
    });
  });

  it("clears the opening row when its popover closes", () => {
    expect(taskPopoverSelection("task-1", "task-1", null)).toEqual({
      selectedId: null,
      openedFromRailId: null,
    });
  });

  it("does not clear a later keyboard selection", () => {
    expect(taskPopoverSelection("task-2", "task-1", null)).toEqual({
      selectedId: "task-2",
      openedFromRailId: null,
    });
  });
});
