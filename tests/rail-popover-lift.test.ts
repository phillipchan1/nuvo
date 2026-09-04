// Rail row lift tracks the open task overlay, not a blur-only notify.
//
// Opening a row and hitting Escape used to leave the glass-lift on, because
// selectedId painted the lift and only an outside-click notify cleared it.
// Overlay is the same bit that mounts the popover, so they appear and vanish
// together — Escape, ✕, and click-away are the same close.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");
function read(relPath: string) {
  return readFileSync(join(SRC, relPath), "utf8");
}

describe("rail row lift follows the task popover", () => {
  it("paints glass-lift from the open overlay, not selectedId", () => {
    const rail = read("components/LeftRail.tsx");
    expect(rail).toMatch(/selected:\s*t\.id === openTaskId/);
    expect(rail).toMatch(/nav\.overlay === "task"/);
    expect(rail).not.toMatch(/onPopoverBlurClose/);
    expect(rail).not.toMatch(/taskPopoverCloseGuard/);
  });

  it("does not notify a blur-only close from TaskPopover", () => {
    const pop = read("components/SlideOver.tsx");
    expect(pop).not.toMatch(/notifyPopoverBlurClose/);
    expect(pop).not.toMatch(/taskPopoverCloseGuard/);
  });
});
