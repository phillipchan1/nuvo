// @vitest-environment jsdom
// One tooltip at a time (D-222): a titled element inside a titled element
// used to show ours for the inner one AND the browser's own for the outer.
import { beforeAll, describe, expect, it } from "vitest";
import { installTooltips } from "../src/lib/tooltips";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }),
  });
  installTooltips(document);
});

const over = (el: Element) => el.dispatchEvent(new Event("pointerover", { bubbles: true }));

describe("tooltips", () => {
  it("mutes a titled ancestor while ours is up, and gives it back after", () => {
    document.body.innerHTML = `<div id="row" title="Drag onto the calendar"><button id="name" title="Open it">Name</button></div>`;
    const row = document.getElementById("row")!;
    const name = document.getElementById("name")!;
    over(name);
    expect(name.dataset.tip).toBe("Open it");
    expect(name.hasAttribute("title")).toBe(false);
    // the browser has nothing left to show for the row
    expect(row.hasAttribute("title")).toBe(false);
    // leaving gives both titles back
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(name.getAttribute("title")).toBe("Open it");
    expect(row.getAttribute("title")).toBe("Drag onto the calendar");
  });

  it("moving from the inner element onto the outer one hands the tooltip over", () => {
    document.body.innerHTML = `<div id="row" title="Drag onto the calendar"><button id="name" title="Open it">Name</button><span id="gap">·</span></div>`;
    const row = document.getElementById("row")!;
    over(document.getElementById("name")!);
    over(document.getElementById("gap")!);
    expect(row.dataset.tip).toBe("Drag onto the calendar");
    expect(document.getElementById("name")!.getAttribute("title")).toBe("Open it");
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(row.getAttribute("title")).toBe("Drag onto the calendar");
  });
});
