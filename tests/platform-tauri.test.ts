/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { isDesktopTauri, isMobileTauri } from "../src/lib/platform";

const ORIGINALS = {
  ua: navigator.userAgent,
  maxTouch: navigator.maxTouchPoints,
};

afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ORIGINALS.ua });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: ORIGINALS.maxTouch });
});

describe("isMobileTauri / isDesktopTauri", () => {
  it("treats a Tauri Mac with a multi-touch trackpad as desktop", () => {
    (window as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
    };
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    expect(isMobileTauri()).toBe(false);
    expect(isDesktopTauri()).toBe(true);
  });

  it("treats the iOS shell as mobile", () => {
    (window as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    expect(isMobileTauri()).toBe(true);
    expect(isDesktopTauri()).toBe(false);
  });
});
