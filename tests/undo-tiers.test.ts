import { describe, expect, it } from "vitest";
import {
  resolveUndoTier,
  TASK_UNDO_DEFAULT,
  undoLabel,
  undoShortLabel,
} from "../src/lib/undoTiers";

describe("undoTiers", () => {
  it("defaults complete/trash to toast and calendar moves to silent", () => {
    expect(TASK_UNDO_DEFAULT.complete).toBe("toast");
    expect(TASK_UNDO_DEFAULT.trash).toBe("toast");
    expect(TASK_UNDO_DEFAULT.planFor).toBe("silent");
    expect(TASK_UNDO_DEFAULT.block).toBe("silent");
    expect(TASK_UNDO_DEFAULT.backToInbox).toBe("silent");
  });

  it("lets call sites override or suppress", () => {
    expect(resolveUndoTier("silent", { undo: "toast" })).toBe("toast");
    expect(resolveUndoTier("toast", { undo: false })).toBe(false);
    expect(resolveUndoTier("silent", undefined)).toBe("silent");
  });

  it("builds singular and batch labels without debt framing", () => {
    expect(undoLabel("complete", "Call David")).toBe("Marked done — Call David");
    expect(undoLabel("complete", "Call David", 3)).toBe("3 tasks marked done");
    expect(undoLabel("uncomplete", "Call David")).toBe("Reopened — Call David");
    expect(undoShortLabel("complete")).toBe("Marked done");
    expect(undoShortLabel("trash", 2)).toBe("2 deleted");
  });
});
