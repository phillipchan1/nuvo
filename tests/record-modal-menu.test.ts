// Record modal ··· must open a menu that clears the record sheet.
//
// Vera's live walk on production (dummy account, 2026-08-23 2am): project
// record top-right "…" never opened (single or double click). Modal Delete
// was unreachable; the workaround was card right-click on On Deck / Groom,
// or Table bulk. The kebab was bound — FloatingMenu portaled at z-70/71
// under RecordScrim (z-81, climbed over the walkthrough in #35). This file
// locks the wiring and the stack so ··· cannot ship unbound or under the
// sheet again.
//
// Reads the deployed source, never a copy — same contract as the floor
// create-CTA and Table-shortcut gates.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");
const rel = (p: string) => p.slice(p.indexOf("/src/") + 1);

function read(relPath: string) {
  return readFileSync(join(SRC, relPath), "utf8");
}

/** Highest `z-[N]` in a slice. Named stacking, not a computed style. */
function maxNamedZ(src: string, label: string) {
  const zs = [...src.matchAll(/z-\[(\d+)\]/g)].map((m) => Number(m[1]));
  expect(zs.length, `${label} must name a z-index`).toBeGreaterThan(0);
  return Math.max(...zs);
}

describe("Record modal overflow menu", () => {
  it("project and initiative records still open ··· onto FloatingMenu + Delete", () => {
    const modal = read("components/record/RecordModal.tsx");
    expect(modal, `${rel("components/record/RecordModal.tsx")} must import FloatingMenu`).toMatch(
      /import\s*\{[\s\S]*FloatingMenu[\s\S]*\}\s*from\s*"\.\.\/floors\/parts"/,
    );

    const project = modal.slice(modal.indexOf("function ProjectRecord"), modal.indexOf("function InitiativeRecord"));
    const initiative = modal.slice(modal.indexOf("function InitiativeRecord"));
    expect(project.length, "ProjectRecord must be in RecordModal").toBeGreaterThan(100);
    expect(initiative.length, "InitiativeRecord must be in RecordModal").toBeGreaterThan(100);

    expect(project, "project kebab must toggle the overflow menu").toMatch(
      /glyph="···"[\s\S]{0,160}onClick=\{\(\) => setMenu\(\(o\) => !o\)\}/,
    );
    expect(project, "project overflow must be a FloatingMenu with Delete").toMatch(
      /<FloatingMenu open=\{menu\}[\s\S]*<DeleteBtn what="project"/,
    );

    expect(initiative, "initiative kebab must toggle the overflow menu").toMatch(
      /glyph="···"[\s\S]{0,160}onClick=\{\(\) => setMenu\(\(o\) => !o\)\}/,
    );
    expect(initiative, "initiative overflow must be a FloatingMenu with Delete").toMatch(
      /<FloatingMenu open=\{menu\}[\s\S]*<DeleteBtn what="initiative"/,
    );
  });

  it("FloatingMenu stacks above RecordScrim so the kebab is visible", () => {
    const parts = read("components/floors/parts.tsx");
    const start = parts.indexOf("export function FloatingMenu");
    const end = parts.indexOf("export const softTint");
    expect(start, "FloatingMenu must be defined in parts.tsx").toBeGreaterThan(-1);
    expect(end, "softTint must follow FloatingMenu").toBeGreaterThan(start);
    const menuZ = maxNamedZ(parts.slice(start, end), "FloatingMenu");

    const scrim = read("components/record/recordFrame.tsx");
    const scrimZ = maxNamedZ(scrim, "RecordScrim");

    expect(menuZ, `FloatingMenu z-${menuZ} must clear RecordScrim z-${scrimZ}`).toBeGreaterThan(scrimZ);
  });

  it("ShipAssess stacks above RecordScrim so shipping from the record is reachable", () => {
    const ship = read("components/record/ShipAssess.tsx");
    const scrim = read("components/record/recordFrame.tsx");
    const ui = read("components/ui.tsx");
    const start = ui.indexOf("export function Modal");
    const modalFn = ui.slice(start, ui.indexOf("export function Btn"));

    const shipZ = maxNamedZ(ship, "ShipAssess");
    const scrimZ = maxNamedZ(scrim, "RecordScrim");
    expect(shipZ, `ShipAssess z-${shipZ} must clear RecordScrim z-${scrimZ}`).toBeGreaterThan(scrimZ);

    // Settings / the calendars walkthrough still need the default at 70.
    expect(modalFn, "Modal's default layer must stay z-[70]").toMatch(/zClass = "z-\[70\]"/);
  });
});
