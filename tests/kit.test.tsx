// @vitest-environment jsdom
/**
 * The kit (D-190) — the parts every page is built from. What is asserted here
 * is the behaviour a screenshot can't show: where a popover lands and when it
 * flips, which days a month grid draws, that a shortcut is always drawn and
 * always spoken, that choices answer the keyboard, and that a menu closes the
 * ways a desktop menu closes.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, Menu, MenuItem, Segmented, TaskCheck, monthGrid, placePopover } from "../src/components/kit";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe("placePopover", () => {
  it("opens below the anchor, aligned to its start", () => {
    const p = placePopover(rect(100, 100, 80, 28), 200, 150, 1200, 800, "bottom-start");
    expect(p).toEqual({ left: 100, top: 134, origin: "top left" });
  });
  it("flips above when there is no room below", () => {
    const p = placePopover(rect(100, 700, 80, 28), 200, 150, 1200, 800, "bottom-start");
    expect(p.top).toBe(700 - 6 - 150);
    expect(p.origin).toBe("top left".replace("top", "bottom"));
  });
  it("end-aligns and grows from the right", () => {
    const p = placePopover(rect(500, 100, 80, 28), 200, 150, 1200, 800, "bottom-end");
    expect(p.left).toBe(580 - 200);
    expect(p.origin).toBe("top right");
  });
  it("never leaves the window", () => {
    const p = placePopover(rect(1150, 100, 40, 28), 300, 150, 1200, 800, "bottom-start");
    expect(p.left).toBe(1200 - 8 - 300);
  });
  it("a submenu opens to the right, or the left when the right is full", () => {
    expect(placePopover(rect(100, 100, 200, 28), 200, 150, 1200, 800, "right-start").left).toBe(306);
    expect(placePopover(rect(900, 100, 200, 28), 200, 150, 1200, 800, "right-start").left).toBe(900 - 6 - 200);
  });
});

describe("monthGrid", () => {
  it("draws six weeks starting on the week's first day", () => {
    const sun = monthGrid(new Date(2026, 10, 12), 0);
    expect(sun).toHaveLength(42);
    expect(sun[0].getDate()).toBe(1); // Nov 1 2026 is a Sunday
    const mon = monthGrid(new Date(2026, 10, 12), 1);
    expect([mon[0].getMonth(), mon[0].getDate()]).toEqual([9, 26]); // Mon Oct 26
  });
});

describe("Button", () => {
  it("draws its shortcut as keycaps", () => {
    const { container } = render(<Button kind="primary" shortcut={["⌘", "K"]}>Capture</Button>);
    expect([...container.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["⌘", "K"]);
    expect(container.querySelector("button")?.dataset.kind).toBe("primary");
  });
  it("an icon button is named, and its tooltip carries the shortcut", () => {
    render(<IconButton label="Capture" shortcut="A" icon={<svg />} />);
    const b = screen.getByRole("button", { name: "Capture" });
    expect(b.getAttribute("title")).toBe("Capture (A)");
  });
});

describe("Segmented", () => {
  function Harness() {
    const [v, setV] = useState<"week" | "month" | "year">("week");
    return (
      <Segmented
        label="View"
        value={v}
        onChange={setV}
        options={[
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
          { value: "year", label: "Year" },
        ]}
      />
    );
  }
  it("is a radio group that arrow keys walk, wrapping", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "View" });
    expect(screen.getByRole("radio", { name: "Week" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Month" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Year" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("TaskCheck", () => {
  it("is a named checkbox that toggles without bubbling to its row", () => {
    const onChange = vi.fn();
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <TaskCheck checked={false} onChange={onChange} label="Run 5k" />
      </div>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Run 5k" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onRow).not.toHaveBeenCalled();
  });
});

describe("Menu", () => {
  it("closes on Escape, on a press outside, and after an item is chosen", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    const onOpen = vi.fn();
    render(
      <Menu anchor={anchor} open onClose={onClose} label="Task">
        <MenuItem onSelect={onOpen} shortcut="↵">Open</MenuItem>
      </Menu>,
    );
    const item = screen.getByRole("menuitem", { name: /Open/ });
    expect(item.closest("[data-nested-surface]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(anchor);
    expect(onClose).toHaveBeenCalledTimes(2); // the trigger toggles, it doesn't dismiss
    fireEvent.click(item);
    expect(onOpen).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("kit.css", () => {
  const css = readFileSync(resolve(__dirname, "../src/styles/kit.css"), "utf8");
  it("uses the kit's four radii, plus their nested (concentric) steps", () => {
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
    const allowed = /^(var\(--r-(chip|ctl|card|dialog)\)|50%|0|5px|7px|8px|10px|1px|2px|2\.5px|2px 2px 0 0|calc\(var\(--r-ctl\) - 2px\)|inherit|999px)$/; // 999px: the switch track (a pill) under touch
    for (const r of radii) expect(r, `radius ${r}`).toMatch(allowed);
  });
  it("never asks for a pointer cursor", () => {
    expect(css).not.toMatch(/cursor:\s*pointer/);
  });
});
