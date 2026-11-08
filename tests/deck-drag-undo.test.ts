import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { writeWithUndo } from "../src/lib/deckUndo";
import type { RecordUndoInput } from "../src/hooks/useUndoStack";

type Card = { startDate: string | null; targetDate: string | null; status: string; name: string };

describe("deck drags are one ⌘Z (writeWithUndo)", () => {
  it("writes the patch, then undo restores exactly the touched fields and redo re-applies", () => {
    const write = vi.fn();
    let entry: RecordUndoInput | null = null;
    const card: Card = { startDate: null, targetDate: "2026-11-13", status: "backlog", name: "Ship it" };
    const patch = { startDate: "2026-11-16", targetDate: "2026-11-20", status: "in_progress" };
    writeWithUndo<Card>(write, card, patch, (e) => (entry = e), "Moved “Ship it”", "moved");

    expect(write).toHaveBeenNthCalledWith(1, patch);
    expect(entry).not.toBeNull();
    expect(entry!.tier).toBe("silent");
    void entry!.undo();
    // an unset start goes back to null (not undefined, which the store would drop); name untouched
    expect(write).toHaveBeenNthCalledWith(2, { startDate: null, targetDate: "2026-11-13", status: "backlog" });
    void entry!.redo!();
    expect(write).toHaveBeenNthCalledWith(3, patch);
  });

  it("an edge resize only restores the edge it moved", () => {
    const write = vi.fn();
    let entry: RecordUndoInput | null = null;
    const card: Card = { startDate: "2026-11-09", targetDate: "2026-11-13", status: "in_progress", name: "x" };
    writeWithUndo<Card>(write, card, { targetDate: "2026-11-27", status: "in_progress" }, (e) => (entry = e), "l", "s");
    void entry!.undo();
    expect(write).toHaveBeenLastCalledWith({ targetDate: "2026-11-13", status: "in_progress" });
  });

  it("the deck drag handlers write only through the undoable path", () => {
    for (const [file, raw] of [
      ["src/components/ondeck/OnDeckPlanner.tsx", "s.updateProject("],
      ["src/components/ondeck/InitiativeDeck.tsx", "s.updateInitiative("],
    ] as const) {
      const src = readFileSync(file, "utf8");
      expect(src.includes(raw), `${file} writes a drag without undo`).toBe(false);
    }
  });
});
