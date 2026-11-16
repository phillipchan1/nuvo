// @vitest-environment jsdom
// [ and ] step a list's own tabs (D-223); digits stay the page's (D-221).
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { listTabTitle, stepTab, useListTabKeys } from "../src/components/kit/listTabKeys";

const press = (key: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));

describe("list tab keys", () => {
  it("steps forward with ] and back with [, wrapping", () => {
    expect(stepTab(["today", "inbox"], "today", 1)).toBe("inbox");
    expect(stepTab(["today", "inbox"], "inbox", 1)).toBe("today");
    expect(stepTab(["today", "inbox", "trash"], "today", -1)).toBe("trash");
  });

  it("binds [ and ], and nothing else — never a digit", () => {
    const on = vi.fn();
    renderHook(() => useListTabKeys(["today", "inbox"], "today", on));
    press("]");
    expect(on).toHaveBeenLastCalledWith("inbox");
    press("[");
    expect(on).toHaveBeenLastCalledWith("inbox"); // from today, back wraps to inbox
    on.mockClear();
    press("2");
    press("1");
    expect(on).not.toHaveBeenCalled();
  });

  it("stands down while typing, under a floating surface, with a modifier, or when disabled", () => {
    const on = vi.fn();
    let enabled = true;
    renderHook(() => useListTabKeys(["a", "b"], "a", on, () => enabled));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true }));
    input.remove();
    const surface = document.createElement("div");
    surface.setAttribute("data-nested-surface", "");
    document.body.appendChild(surface);
    press("]");
    surface.remove();
    press("]", { metaKey: true });
    enabled = false;
    press("]");
    expect(on).not.toHaveBeenCalled();
    enabled = true;
    press("]");
    expect(on).toHaveBeenCalledWith("b");
  });

  it("says its keys on hover in the app's one shape", () => {
    expect(listTabTitle("Today")).toBe("Today ([ ])");
  });
});
