// Anytime drop-hover — only the cell under the pointer lights.
//
// #65 (nuvo#65) removed the drag-start wash that armed every anytime cell
// (`.cal-dragging .fc-daygrid-body .fc-daygrid-day .fc-daygrid-day-frame`
// inset/bg). The drop-hover rule
// (`.fc .fc-daygrid-body .fc-daygrid-day.anytime-drop-target .fc-daygrid-day-frame`)
// stays: CalendarPane hit-tests the cell under the pointer and toggles that
// class. A browser drag is not required — this file pins the CSS contract
// (and that the class is still applied in source) the same way type-scale
// and token-contrast read the deployed stylesheet, never a copy.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

function read(relPath: string) {
  return readFileSync(join(SRC, relPath), "utf8");
}

/** Body of the first rule whose selector equals `selector` (trimmed). */
function ruleBody(css: string, selector: string): string | null {
  const needle = selector.replace(/\s+/g, " ").trim();
  let from = 0;
  while (from < css.length) {
    const open = css.indexOf("{", from);
    if (open < 0) return null;
    const head = css.slice(from, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const close = css.indexOf("}", open);
    if (close < 0) return null;
    if (head.replace(/\s+/g, " ") === needle) return css.slice(open + 1, close);
    from = close + 1;
  }
  return null;
}

const ARMED_ALL_CELLS = ".cal-dragging .fc-daygrid-body .fc-daygrid-day .fc-daygrid-day-frame";
const DROP_TARGET = ".fc .fc-daygrid-body .fc-daygrid-day.anytime-drop-target .fc-daygrid-day-frame";
const DRAG_TRANSITION = ".cal-dragging .fc-daygrid-body .fc-daygrid-day-frame";

describe("anytime drop-hover CSS", () => {
  it("does not wash every anytime cell at drag start", () => {
    const css = read("index.css");
    expect(
      css.includes(ARMED_ALL_CELLS),
      `armed-all-cells rule must stay gone: ${ARMED_ALL_CELLS}`,
    ).toBe(false);
    expect(ruleBody(css, ARMED_ALL_CELLS)).toBeNull();

    // The leftover `.cal-dragging` rule is a transition only — painting it
    // would bring the wash back under a different selector.
    const leftover = ruleBody(css, DRAG_TRANSITION);
    expect(leftover, `${DRAG_TRANSITION} should remain as a transition`).toBeTruthy();
    expect(leftover, "drag-start leftover must not paint a wash").not.toMatch(/\bbackground\s*:/);
    expect(leftover, "drag-start leftover must not paint an inset").not.toMatch(/\bbox-shadow\s*:/);
    expect(leftover).toMatch(/\btransition\s*:/);
  });

  it("lights only the anytime-drop-target cell under the pointer", () => {
    const css = read("index.css");
    const body = ruleBody(css, DROP_TARGET);
    expect(body, `drop-target rule must remain: ${DROP_TARGET}`).toBeTruthy();
    expect(body, "drop-target must paint a background").toMatch(/\bbackground\s*:/);
    expect(body, "drop-target must paint an inset/ring").toMatch(/\bbox-shadow\s*:/);
  });

  it("CalendarPane still hit-tests the cell and toggles anytime-drop-target", () => {
    const pane = read("components/CalendarPane.tsx");
    expect(pane, "must add anytime-drop-target on the cell under the pointer").toMatch(
      /anytimeEl\?\.classList\.add\("anytime-drop-target"\)/,
    );
    expect(pane, "must clear anytime-drop-target when the pointer leaves").toMatch(
      /overAnytime\?\.classList\.remove\("anytime-drop-target"\)/,
    );
  });
});
