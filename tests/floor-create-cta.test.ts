// Empty-state create CTAs must open the same CreateRecord sheet as Table / P.
//
// Vera's live walk on production (dummy account, after 82b779b): Projects →
// On Deck "Add your first project" was a no-op (clicked twice). Create only
// worked from Table "+ new project" and/or P. The FloorGuide label was bound
// in source — the sheet sat under the walkthrough (z-60 vs z-80) and the
// lazy chunk painted nothing while it loaded. This file locks the *wiring*
// and the stacking, so a future empty CTA cannot ship unbound or under the
// walk again.
//
// Reads the deployed source, never a copy — same contract as the keyboard
// and type-scale gates.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");
const rel = (p: string) => p.slice(p.indexOf("/src/") + 1);

function read(relPath: string) {
  return readFileSync(join(SRC, relPath), "utf8");
}

describe("On Deck empty create CTA", () => {
  it("FloorGuide 'Add your first project' opens new-project, same as Table / P", () => {
    const onDeck = read("components/floors/OnDeckFloor.tsx");
    expect(onDeck, `${rel("components/floors/OnDeckFloor.tsx")} must show FloorGuide when empty`).toMatch(
      /actionLabel="Add your first project"/,
    );
    expect(onDeck, "empty On Deck CTA must call openFloorModal('new-project')").toMatch(
      /onAction=\{\(\) => openFloorModal\("new-project"\)\}/,
    );

    const table = read("components/floors/PortfolioFloor.tsx");
    expect(table, "Table '+ new project' must stay on the same path").toMatch(
      /onNew:\s*\(\) => openFloorModal\("new-project"\)/,
    );

    const shell = read("components/AppShell.tsx");
    expect(shell, "P must stay on the same path").toMatch(
      /openFloorModal\(key === "p" \? "new-project" : "new-initiative"\)/,
    );
  });

  it("On Deck rail ＋ and the no-domain week fallback open the same sheet", () => {
    const planner = read("components/ondeck/OnDeckPlanner.tsx");
    expect(planner, "rail foot must open CreateRecord, not a second composer").toMatch(
      /onFoot=\{\(\) => openFloorModal\("new-project"\)\}/,
    );
    expect(planner, "week compose without a domain must fall through to CreateRecord").toMatch(
      /openFloorModal\("new-project"\)/,
    );
  });

  it("FloorGuide will not paint a label without a handler", () => {
    const guide = read("components/orientation/FloorGuide.tsx");
    expect(guide).toMatch(/actionLabel && onAction/);
    expect(guide).toMatch(/onClick=\{onAction\}/);
  });

  it("the create sheet stacks above the live walkthrough", () => {
    const scrim = read("components/record/recordFrame.tsx");
    const teach = read("components/orientation/TeachPanel.tsx");
    const scrimZ = Number((/z-\[(\d+)\]/.exec(scrim) ?? [])[1]);
    const teachZ = Number((/z-\[(\d+)\]/.exec(teach) ?? [])[1]);
    expect(scrimZ, "RecordScrim must name a z-index").toBeGreaterThan(0);
    expect(teachZ, "TeachPanel must name a z-index").toBeGreaterThan(0);
    expect(scrimZ, `RecordScrim z-${scrimZ} must clear TeachPanel z-${teachZ}`).toBeGreaterThan(teachZ);
  });
});
