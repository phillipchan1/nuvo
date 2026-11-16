// @vitest-environment jsdom
/**
 * An iPad wears the desktop shell when it has a desktop's room (D-218).
 *
 * Three things have to stay true for that to be real and not a screenshot:
 *  1. The native iOS app picks its shell by VIEWPORT — it used to force the
 *     phone shell, which put an 11" iPad (1180×820) on the phone layout.
 *  2. Under a finger, a long-press reaches the same menu a right-click does —
 *     iPadOS never fires `contextmenu` for touch, so ~40 desktop menus were
 *     otherwise unreachable.
 *  3. The menu's long-press never steals a scroll, a mouse, or a plain tap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "../src/hooks/useIsMobile";
import { installTouchContextMenu, LONG_PRESS_MS } from "../src/lib/touchContextMenu";

const UA = navigator.userAgent;

function matchMediaFor(matches: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

describe("useIsMobile on the native iOS app", () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    });
  });
  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: UA });
  });

  it("gives a wide iPad the desktop shell", () => {
    window.matchMedia = matchMediaFor(false);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("still gives a narrow window (an iPhone, or Split View) the phone shell", () => {
    window.matchMedia = matchMediaFor(true);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });
});

describe("the iOS project", () => {
  const script = readFileSync(join(__dirname, "../scripts/ios-postinit.sh"), "utf8");
  it("keeps the iPhone portrait and lets the iPad rotate", () => {
    expect(script).toMatch(/Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait/);
    expect(script).toMatch(/UISupportedInterfaceOrientations~ipad/);
    for (const o of ["Portrait", "PortraitUpsideDown", "LandscapeLeft", "LandscapeRight"]) {
      expect(script).toContain(o);
    }
  });
});

describe("installTouchContextMenu", () => {
  let off: () => void;
  let row: HTMLDivElement;
  let menus: number;
  let clicks: number;

  function pointer(type: string, init: Partial<PointerEventInit> = {}) {
    // jsdom has no PointerEvent constructor; a MouseEvent carrying the fields is
    // what the listener reads.
    const { pointerType = "touch", ...pos } = init;
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, ...pos });
    Object.assign(e, { pointerType, pointerId: 1, isPrimary: true });
    row.dispatchEvent(e);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    menus = 0;
    clicks = 0;
    row = document.createElement("div");
    row.addEventListener("contextmenu", (e) => {
      menus++;
      e.preventDefault(); // the row has a menu of its own
    });
    row.addEventListener("click", () => clicks++);
    document.body.appendChild(row);
    off = installTouchContextMenu(document);
  });
  afterEach(() => {
    off();
    row.remove();
    vi.useRealTimers();
  });

  it("a held finger opens the row's own menu, and the lift doesn't also open the row", () => {
    pointer("pointerdown");
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toBe(1);
    pointer("pointerup");
    row.click();
    expect(clicks).toBe(0);
    row.click();
    expect(clicks).toBe(1); // only the one lift is swallowed
  });

  it("a quick tap is just a tap", () => {
    pointer("pointerdown");
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    pointer("pointerup");
    vi.advanceTimersByTime(LONG_PRESS_MS);
    row.click();
    expect(menus).toBe(0);
    expect(clicks).toBe(1);
  });

  it("a finger that travels is scrolling or dragging, not asking", () => {
    pointer("pointerdown");
    pointer("pointermove", { clientX: 40, clientY: 10 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toBe(0);
  });

  it("a browser-taken gesture (pointercancel) never opens a menu", () => {
    pointer("pointerdown");
    pointer("pointercancel");
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toBe(0);
  });

  it("leaves the mouse alone — it already right-clicks", () => {
    pointer("pointerdown", { pointerType: "mouse" } as Partial<PointerEventInit>);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toBe(0);
  });
});
