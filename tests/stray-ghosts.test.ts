// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectionLost, sweepStrayGhosts } from "../src/components/calendar/strayGhosts";

const grid = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

describe("sweepStrayGhosts", () => {
  it("puts away a left-over drag mirror and in-hand classes", () => {
    const root = grid(`
      <div class="fc-event fc-event-mirror" data-drag-mirror id="m"></div>
      <div class="fc-event fc-event-dragging" id="d"></div>
      <div class="fc-event fc-event-resizing" id="r"></div>`);
    expect(sweepStrayGhosts(root)).toBe(3);
    expect(root.querySelector("#m")!.hasAttribute("data-stray")).toBe(true);
    expect(root.querySelector("#d")!.classList.contains("fc-event-dragging")).toBe(false);
    expect(root.querySelector("#r")!.classList.contains("fc-event-resizing")).toBe(false);
  });

  it("never touches the composer's select-mirror or an ordinary block", () => {
    const root = grid(`
      <div class="fc-event fc-event-mirror" id="select"></div>
      <div class="fc-event evt-focused" id="block"></div>`);
    expect(sweepStrayGhosts(root)).toBe(0);
    expect(root.querySelector("#select")!.hasAttribute("data-stray")).toBe(false);
  });

  it("is idempotent", () => {
    const root = grid(`<div class="fc-event fc-event-mirror" data-drag-mirror></div>`);
    sweepStrayGhosts(root);
    expect(sweepStrayGhosts(root)).toBe(0);
  });
});

describe("selectionLost", () => {
  const ids = (...x: string[]) => new Set(x);
  it("is true when the selected block was on the grid and is gone", () => {
    expect(selectionLost(ids("a", "b"), ids("b"), "a")).toBe(true);
  });
  it("leaves a block selected before it lands alone", () => {
    expect(selectionLost(ids("b"), ids("b"), "new")).toBe(false);
  });
  it("is false with no selection or a block still there", () => {
    expect(selectionLost(ids("a"), ids("a"), null)).toBe(false);
    expect(selectionLost(ids("a"), ids("a"), "a")).toBe(false);
  });
});
