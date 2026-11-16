// @vitest-environment jsdom
/**
 * A page's views answer to bare 1…N, in the order the bar draws them, and 1 is
 * home. The digit is also stamped into each tab's hover title.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePageTabKeys, withPageTabKeys } from "../src/components/kit/pageTabKeys";

const TABS = withPageTabKeys([
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "spread", label: "Spread" },
] as const);

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
}

describe("usePageTabKeys", () => {
  it("stamps each tab with its digit — the hover hint", () => {
    expect(TABS.map((t) => t.title)).toEqual(["Week (1)", "Day (2)", "Spread (3)"]);
  });

  it("1…N pick the tab in that place; past the end does nothing", () => {
    const onChange = vi.fn();
    renderHook(() => usePageTabKeys(TABS, onChange));
    expect(press("1").defaultPrevented).toBe(true);
    press("3");
    expect(onChange.mock.calls).toEqual([["week"], ["spread"]]);
    expect(press("4").defaultPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("stands down for chords, typing, a floating surface, a spent key and a hidden page", () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(({ on }) => usePageTabKeys(TABS, onChange, on), { initialProps: { on: true } });
    press("2", { metaKey: true });
    press("2", { altKey: true });
    press("2", { ctrlKey: true });
    const input = document.body.appendChild(document.createElement("input"));
    press("2", {}, input);
    input.remove();
    const pop = document.body.appendChild(document.createElement("div"));
    pop.setAttribute("data-nested-surface", "");
    press("2");
    pop.remove();
    const spent = new KeyboardEvent("keydown", { key: "2", cancelable: true });
    window.addEventListener("keydown", (e) => e.preventDefault(), { capture: true, once: true });
    act(() => void window.dispatchEvent(spent));
    rerender({ on: false });
    press("2");
    expect(onChange).not.toHaveBeenCalled();
  });
});
