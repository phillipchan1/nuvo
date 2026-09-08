/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isDesktopTauri, isMobileTauri, isTauriIOS, offerMacDownload } from "../src/lib/platform";

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
    expect(isTauriIOS()).toBe(true);
    expect(isDesktopTauri()).toBe(false);
  });

  it("treats an explicit iPad UA as iOS", () => {
    (window as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    });
    expect(isTauriIOS()).toBe(true);
    expect(isMobileTauri()).toBe(true);
  });

  it("does not treat a Macintosh UA + trackpad as iPad — __TAURI_IOS__ is the stamp", () => {
    (window as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
    };
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    expect(isTauriIOS()).toBe(false);
    expect(isMobileTauri()).toBe(false);
  });
});

describe("the iOS Vite stamp", () => {
  it("defines __TAURI_IOS__ from TAURI_ENV_PLATFORM, not from the UA", () => {
    const vite = readFileSync(join(import.meta.dirname, "..", "vite.config.ts"), "utf8");
    expect(vite).toContain("__TAURI_IOS__");
    expect(vite).toContain("isIosTauriBuild");
  });
});

describe("offerMacDownload", () => {
  it("offers the DMG only on a desktop browser — never in the Mac app or on a phone", () => {
    expect(offerMacDownload({ desktopTauri: false, mobile: false })).toBe(true);
    expect(offerMacDownload({ desktopTauri: true, mobile: false })).toBe(false);
    expect(offerMacDownload({ desktopTauri: false, mobile: true })).toBe(false);
    expect(offerMacDownload({ desktopTauri: true, mobile: true })).toBe(false);
  });

  it("Settings → About gates the Mac download on that rule, not on 'not Tauri'", () => {
    const settings = readFileSync(join(import.meta.dirname, "..", "src/components/SettingsModal.tsx"), "utf8");
    expect(settings).toContain("offerMacDownload");
    expect(settings).toContain("showMacDownload");
    // The old branch treated every non-Tauri shell — including the iPhone — as
    // a download surface. The phone path must be able to render nothing.
    expect(settings).toMatch(/showMacDownload \? \([\s\S]*Download for Mac[\s\S]*\) : null/);
  });
});
