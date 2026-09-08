/** @vitest-environment jsdom */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signInWithApple = vi.fn();
const signInWithGoogle = vi.fn();
const signInWithPassword = vi.fn();
const signInWithOtp = vi.fn();

vi.mock("../src/lib/appleAuth", () => ({
  appleSignInAvailable: () => true,
  isAppleSignInCancelled: (message: string | null | undefined) =>
    (message ?? "").includes("cancelled"),
  signInWithApple: () => signInWithApple(),
}));

vi.mock("../src/lib/googleAuth", () => ({
  signInWithGoogle: () => signInWithGoogle(),
}));

vi.mock("../src/lib/supabase", () => ({
  supabaseConfigured: true,
  supabase: {
    auth: {
      signInWithPassword: (args: { email: string; password: string }) => signInWithPassword(args),
      signInWithOtp: (args: { email: string }) => signInWithOtp(args),
      verifyOtp: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/platform", () => ({
  isMobileTauri: () => true,
  isTauriIOS: () => true,
}));

vi.mock("../src/lib/authProviders", () => ({
  lastAuthProvider: () => null,
  providerLabel: (p: string) => p,
}));

import Login from "../src/components/Login";

function buttonNamed(host: HTMLElement, name: string): HTMLButtonElement {
  const btn = [...host.querySelectorAll("button")].find((el) =>
    (el.textContent ?? "").includes(name),
  );
  if (!btn) throw new Error(`no button named ${name}`);
  return btn as HTMLButtonElement;
}

function firePointer(el: Element, pointerType: string) {
  const ev = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.assign(ev, { button: 0, pointerType });
  el.dispatchEvent(ev);
}

function nativeInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Login (iOS review + iPad tap)", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    signInWithApple.mockReset();
    signInWithGoogle.mockReset();
    signInWithPassword.mockReset();
    signInWithOtp.mockReset();
    signInWithApple.mockReturnValue(new Promise(() => {}));
    signInWithGoogle.mockReturnValue(new Promise(() => {}));
    signInWithPassword.mockResolvedValue({ error: null });
    signInWithOtp.mockResolvedValue({ error: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function mount() {
    act(() => {
      root.render(createElement(Login, { forcePasswordLogin: true }));
    });
  }

  it("offers Apple, Google, and email on the review / iOS door", () => {
    mount();
    expect(buttonNamed(host, "Sign in with Apple")).toBeTruthy();
    expect(buttonNamed(host, "Continue with Google")).toBeTruthy();
    expect(buttonNamed(host, "Sign in with email")).toBeTruthy();
  });

  it("starts Apple on a touch pointerdown (before the synthesized click)", () => {
    mount();
    const apple = buttonNamed(host, "Sign in with Apple");
    act(() => {
      firePointer(apple, "touch");
    });
    expect(signInWithApple).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Opening…");
    expect(host.textContent).toContain("Opening Apple");
  });

  it("still starts Google after the iPad mouseenter/leave dance + click", () => {
    mount();
    const google = buttonNamed(host, "Continue with Google");
    act(() => {
      google.dispatchEvent(new Event("mouseenter", { bubbles: true }));
      google.dispatchEvent(new Event("mouseleave", { bubbles: true }));
      google.click();
    });
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it("keeps email tappable while OAuth is opening", () => {
    mount();
    act(() => {
      firePointer(buttonNamed(host, "Sign in with Apple"), "touch");
    });
    const email = buttonNamed(host, "Sign in with email");
    expect(email.disabled).toBe(false);
    act(() => {
      firePointer(email, "touch");
    });
    expect(host.querySelector("input[type=\"email\"]")).toBeTruthy();
    expect(host.querySelector("input[type=\"password\"]")).toBeTruthy();
  });

  it("signs in with password — no OTP", async () => {
    mount();
    act(() => {
      firePointer(buttonNamed(host, "Sign in with email"), "touch");
    });
    const email = host.querySelector('input[type="email"]') as HTMLInputElement;
    const password = host.querySelector('input[type="password"]') as HTMLInputElement;
    act(() => {
      nativeInput(email, "review@example.com");
      nativeInput(password, "review-password");
    });
    await act(async () => {
      firePointer(buttonNamed(host, "Sign in"), "touch");
      await Promise.resolve();
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "review@example.com",
      password: "review-password",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("keeps OTP as a secondary door from the password form", () => {
    mount();
    act(() => {
      firePointer(buttonNamed(host, "Sign in with email"), "touch");
    });
    expect(buttonNamed(host, "Email me a code instead")).toBeTruthy();
  });
});

describe("Login source — review door and iPad taps", () => {
  it("uses signInWithPassword and useTapAction", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const login = readFileSync(join(import.meta.dirname, "..", "src/components/Login.tsx"), "utf8");
    expect(login).toContain("signInWithPassword");
    expect(login).toContain("useTapAction");
    expect(login).toContain("Sign in with email");
    expect(login).toContain("isReviewPasswordLogin");
    // Apple and Google stay — guideline 4.8.
    expect(login).toContain("signInWithApple");
    expect(login).toContain("signInWithGoogle");
    // Hover is CSS-only; no mouseenter setState.
    expect(login).not.toMatch(/onMouseEnter/);
    expect(login).not.toMatch(/onMouseLeave/);
  });
});
