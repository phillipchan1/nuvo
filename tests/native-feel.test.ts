// @vitest-environment jsdom
// The native-feel primitives (docs/native-feel/03-interaction-primitives.md).
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rubberBand, releaseVelocity, resistedTravel } from "../src/lib/gesture";
import { shortcutLabel } from "../src/lib/shortcutLabel";
import { stepIndex, typeaheadIndex } from "../src/hooks/useMenuFocus";
import { placeTip } from "../src/lib/tooltips";
import { wantsBrowserMenu } from "../src/lib/nativeFeel";
import { armDragCancel } from "../src/lib/dragCancel";

describe("gesture physics", () => {
  it("rubber band never reaches the dimension and is monotonic", () => {
    expect(rubberBand(0, 100)).toBe(0);
    const a = rubberBand(50, 100);
    const b = rubberBand(500, 100);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(100);
  });
  it("resisted travel is 1:1 to the threshold, resisted after, symmetric", () => {
    expect(resistedTravel(40, 60, 150)).toBe(40);
    expect(resistedTravel(-40, 60, 150)).toBe(-40);
    const r = resistedTravel(200, 60, 150);
    expect(r).toBeGreaterThan(60);
    expect(r).toBeLessThan(150);
    expect(resistedTravel(-200, 60, 150)).toBeCloseTo(-r);
  });
  it("release velocity reads the last window, so a pause before lifting is slow", () => {
    const flick = [{ y: 0, t: 0 }, { y: 40, t: 40 }, { y: 100, t: 80 }];
    expect(releaseVelocity(flick)).toBeGreaterThan(0.5);
    const paused = [{ y: 0, t: 0 }, { y: 100, t: 50 }, { y: 101, t: 400 }];
    expect(releaseVelocity(paused)).toBeLessThan(0.05);
    expect(releaseVelocity([{ y: 0, t: 0 }])).toBe(0);
  });
});

describe("shortcut labels", () => {
  it("keeps Mac glyphs on a Mac", () => {
    expect(shortcutLabel("⇧⌘Z", true)).toBe("⇧⌘Z");
  });
  it("spells modifiers out elsewhere, in a stable order", () => {
    expect(shortcutLabel("⌘K", false)).toBe("Ctrl+K");
    expect(shortcutLabel("⇧⌘Z", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("⌥↑", false)).toBe("Alt+↑");
    expect(shortcutLabel("E", false)).toBe("E");
    expect(shortcutLabel("⌫", false)).toBe("⌫");
  });
});

describe("menu keyboard", () => {
  it("arrows wrap; Home/End jump; first press lands on an end", () => {
    expect(stepIndex("ArrowDown", -1, 3)).toBe(0);
    expect(stepIndex("ArrowUp", -1, 3)).toBe(2);
    expect(stepIndex("ArrowDown", 2, 3)).toBe(0);
    expect(stepIndex("ArrowUp", 0, 3)).toBe(2);
    expect(stepIndex("Home", 2, 3)).toBe(0);
    expect(stepIndex("End", 0, 3)).toBe(2);
    expect(stepIndex("x", 0, 3)).toBeNull();
    expect(stepIndex("ArrowDown", 0, 0)).toBeNull();
  });
  it("type-ahead cycles through matches after the current item", () => {
    const labels = ["Open", "Park", "Pin", "Delete"];
    expect(typeaheadIndex(labels, "p", -1)).toBe(1);
    expect(typeaheadIndex(labels, "p", 1)).toBe(2);
    expect(typeaheadIndex(labels, "p", 2)).toBe(1);
    expect(typeaheadIndex(labels, "pi", 0)).toBe(2);
    expect(typeaheadIndex(labels, "z", 0)).toBe(-1);
  });
});

describe("tooltip placement", () => {
  const vp = { width: 400, height: 300 };
  it("sits centred below the anchor", () => {
    expect(placeTip({ left: 100, top: 50, width: 40, height: 20 }, { width: 60, height: 20 }, vp)).toEqual({ left: 90, top: 76 });
  });
  it("flips above near the bottom and clamps to the sides", () => {
    const p = placeTip({ left: 390, top: 280, width: 10, height: 10 }, { width: 100, height: 20 }, vp);
    expect(p.top).toBe(254);
    expect(p.left).toBe(294);
  });
});

describe("browser context menu", () => {
  it("is kept for fields, links, selectable content and ⇧-right-click; suppressed on chrome", () => {
    document.body.innerHTML = `
      <input id="i"/><textarea id="t"></textarea>
      <a id="a" href="https://x"><span id="as">x</span></a>
      <div data-selectable><p id="p">notes</p></div>
      <div role="button" id="b">Row</div>`;
    const $ = (id: string) => document.getElementById(id);
    expect(wantsBrowserMenu($("i"))).toBe(true);
    expect(wantsBrowserMenu($("t"))).toBe(true);
    expect(wantsBrowserMenu($("as"))).toBe(true);
    expect(wantsBrowserMenu($("p"))).toBe(true);
    expect(wantsBrowserMenu($("b"))).toBe(false);
    expect(wantsBrowserMenu($("b"), { shiftKey: true })).toBe(true);
  });
});

describe("drag cancel", () => {
  it("Escape cancels once and swallows the key", () => {
    const onCancel = vi.fn();
    const other = vi.fn();
    window.addEventListener("keydown", other);
    armDragCancel(onCancel);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1); // only the second, un-armed press
    window.removeEventListener("keydown", other);
  });
  it("the disposer disarms it", () => {
    const onCancel = vi.fn();
    const dispose = armDragCancel(onCancel);
    dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new Event("blur"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("the web-isms reset holds", () => {
  const native = readFileSync(resolve(__dirname, "../src/styles/native.css"), "utf8");
  const index = readFileSync(resolve(__dirname, "../src/index.css"), "utf8");
  const main = readFileSync(resolve(__dirname, "../src/main.tsx"), "utf8");
  it("is loaded and installed", () => {
    expect(main).toMatch(/import "\.\/styles\/native\.css"/);
    expect(main).toMatch(/installNativeFeel\(\)/);
  });
  it("kills the tap flash, the callout and whole-UI rubber-banding", () => {
    expect(native).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    expect(native).toMatch(/-webkit-touch-callout:\s*none/);
    expect(native).toMatch(/overscroll-behavior:\s*none/);
  });
  it("buttons wear the arrow, not the hand", () => {
    expect(index).not.toMatch(/button\s*\{\s*cursor:\s*pointer/);
  });
  it("every hand-written :hover in index.css sits behind (hover: hover)", () => {
    // Walk top-level rules; a :hover selector outside an @media(hover) is a
    // sticky-hover bug on touch.
    const css = index.replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    const stack: boolean[] = [];
    let buf = "";
    const offenders: string[] = [];
    for (const ch of css) {
      if (ch === "{") {
        const prelude = buf.trim();
        const isHoverMedia = /^@media[^{]*hover:\s*hover/.test(prelude);
        const inHover = stack.some(Boolean) || isHoverMedia;
        if (!prelude.startsWith("@") && /:hover/.test(prelude) && !stack.some(Boolean)) offenders.push(prelude);
        stack.push(inHover && prelude.startsWith("@") ? true : stack.some(Boolean));
        depth++;
        buf = "";
      } else if (ch === "}") {
        stack.pop();
        depth--;
        buf = "";
      } else if (ch === ";") {
        buf = "";
      } else buf += ch;
    }
    expect(offenders).toEqual([]);
  });
});
