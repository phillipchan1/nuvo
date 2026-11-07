// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Blocker 10 (docs/cloudflare-cutover.md): the signed Better Auth bearer must
// survive a relaunch. WKWebView and an installed PWA start each launch with an
// empty sessionStorage, so the bearer lives in localStorage.
const KEY = "nuvo.ba.signed-bearer";
const SIGNED = "rawtoken.c2lnbmF0dXJl";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
// Node's own (flag-less) localStorage global shadows jsdom's; stub both.
const localStorage = memoryStorage();
const sessionStorage = memoryStorage();
vi.stubGlobal("localStorage", localStorage);
vi.stubGlobal("sessionStorage", sessionStorage);

async function fresh() {
  vi.resetModules();
  return await import("../src/lib/authClient");
}

describe("signed bearer storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("persists to localStorage and survives a relaunch (sessionStorage wiped, module reloaded)", async () => {
    const a = await fresh();
    a.persistSignedBearer(SIGNED);
    expect(localStorage.getItem(KEY)).toBe(SIGNED);
    expect(sessionStorage.getItem(KEY)).toBeNull();

    sessionStorage.clear(); // what a WKWebView relaunch does
    const b = await fresh();
    expect(b.signedBearerToken()).toBe(SIGNED);
  });

  it("never stores a raw (unsigned) session token", async () => {
    const a = await fresh();
    a.persistSignedBearer("rawtoken-without-signature");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("adopts a bearer left in sessionStorage by an older build, once", async () => {
    sessionStorage.setItem(KEY, SIGNED);
    const a = await fresh();
    expect(a.signedBearerToken()).toBe(SIGNED);
    expect(localStorage.getItem(KEY)).toBe(SIGNED);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("sign-out clears both stores and announces the change", async () => {
    localStorage.setItem(KEY, SIGNED);
    sessionStorage.setItem(KEY, SIGNED);
    const a = await fresh();
    const seen = vi.fn();
    window.addEventListener(a.AUTH_SESSION_CHANGED, seen);
    a.clearSignedBearer();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(a.signedBearerToken()).toBeNull();
    expect(seen).toHaveBeenCalled();
  });

  it("a sign-out in another tab re-reads the session here", async () => {
    const a = await fresh();
    const seen = vi.fn();
    window.addEventListener(a.AUTH_SESSION_CHANGED, seen);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, oldValue: SIGNED, newValue: null }));
    expect(seen).toHaveBeenCalled();
  });

  it("no code path writes the bearer to sessionStorage any more", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "../src/lib/authClient.ts"), "utf8");
    expect(src).not.toMatch(/sessionStorage\.setItem/);
  });
});
