/** @vitest-environment jsdom */
import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { isOAuthCanceled, useTapAction } from "../src/lib/tapAction";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const [n, setN] = useState(0);
  const tap = useTapAction(() => setN((v) => v + 1));
  return createElement("button", { type: "button", ...tap }, String(n));
}

describe("isOAuthCanceled", () => {
  it("treats a user-dismissed sheet as a cancel", () => {
    expect(isOAuthCanceled(new Error("Sign in with Apple was cancelled"))).toBe(true);
    expect(isOAuthCanceled(new Error("The user canceled the operation."))).toBe(true);
  });

  it("does not swallow a real present failure", () => {
    expect(isOAuthCanceled(new Error("Could not start in-app OAuth session"))).toBe(false);
    expect(isOAuthCanceled(new Error("No authorization code in OAuth callback"))).toBe(false);
  });
});

describe("useTapAction", () => {
  let host: HTMLDivElement;

  afterEach(() => {
    host?.remove();
  });

  it("fires once for touch pointerdown and ignores the follow-up click", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(Probe));
    });
    const btn = host.querySelector("button")!;
    act(() => {
      const down = new Event("pointerdown", { bubbles: true, cancelable: true });
      Object.assign(down, { button: 0, pointerType: "touch" });
      btn.dispatchEvent(down);
    });
    expect(btn.textContent).toBe("1");
    act(() => {
      btn.click();
    });
    expect(btn.textContent).toBe("1");
    act(() => root.unmount());
  });

  it("fires on a mouse click", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(Probe));
    });
    const btn = host.querySelector("button")!;
    act(() => {
      btn.click();
    });
    expect(btn.textContent).toBe("1");
    act(() => root.unmount());
  });
});
