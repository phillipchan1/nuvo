// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// The SPA half of the Worker's sign-in door (blockers 2 / 2b). The token is
// single-use and must leave the address bar the moment it is read.

describe("auth return (door → shell)", () => {
  async function load(apiBase = "https://api.nuvo.day/api") {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", apiBase);
    return await import("../src/lib/authReturn");
  }

  it("builds the door URL for this origin, with no bearer in it", async () => {
    const m = await load();
    const url = new URL(m.signInDoorUrl("google"));
    expect(url.origin + url.pathname).toBe("https://api.nuvo.day/api/signin/google");
    expect(url.searchParams.get("return")).toBe(window.location.origin);
    expect(url.searchParams.has("link")).toBe(false);
    const link = new URL(m.signInDoorUrl("apple", "ott123"));
    expect(link.pathname).toBe("/api/signin/apple");
    expect(link.searchParams.get("link")).toBe("ott123");
  });

  it("redeems #nuvo_ott once and strips it from the URL", async () => {
    const m = await load();
    window.history.replaceState(null, "", "/?x=1#nuvo_ott=abc123");
    const verify = vi.fn(async () => ({ data: {}, error: null }));
    expect(await m.consumeAuthReturn(verify)).toBe("ott");
    expect(verify).toHaveBeenCalledWith("abc123");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?x=1");
    expect(m.authReturnError()).toBeNull();
    // A second boot finds nothing to redeem.
    expect(await m.consumeAuthReturn(verify)).toBe("none");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("turns #nuvo_auth_error into a sentence for the login screen", async () => {
    const m = await load();
    window.history.replaceState(null, "", "/#nuvo_auth_error=provider_not_configured");
    expect(await m.consumeAuthReturn(vi.fn())).toBe("error");
    expect(m.authReturnError()).toMatch(/isn't available right now/);
    expect(window.location.hash).toBe("");
    m.clearAuthReturnError();
    expect(m.authReturnError()).toBeNull();
  });

  it("a rejected token is reported, never thrown", async () => {
    const m = await load();
    window.history.replaceState(null, "", "/#nuvo_ott=dead");
    await m.consumeAuthReturn(async () => ({ error: { message: "Invalid token" } }));
    expect(m.authReturnError()).toMatch(/didn't finish/);
  });

  it("leaves unrelated fragments alone", async () => {
    const m = await load();
    window.history.replaceState(null, "", "/#settings");
    expect(await m.consumeAuthReturn(vi.fn())).toBe("none");
    expect(window.location.hash).toBe("#settings");
  });
});

describe("Google keeps D-126 on both backends", () => {
  it("flag off: GoTrue still gets prompt=select_account", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "");
    const signInWithOAuth = vi.fn(async () => ({ data: {}, error: null }));
    vi.doMock("../src/lib/supabase", () => ({ supabase: { auth: { signInWithOAuth, linkIdentity: vi.fn() } } }));
    const g = await import("../src/lib/googleAuth");
    await g.signInWithGoogle();
    expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google",
      options: expect.objectContaining({ queryParams: { prompt: "select_account" } }),
    }));
    vi.doUnmock("../src/lib/supabase");
  });

  it("flag on: walks the Worker door (whose Google provider carries the prompt)", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day/api");
    const signInWithOAuth = vi.fn();
    vi.doMock("../src/lib/supabase", () => ({ supabase: { auth: { signInWithOAuth, linkIdentity: vi.fn() } } }));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, origin: "tauri://localhost", protocol: "tauri:", host: "localhost" });
    const { setWorkersEnabled, resetWorkersEnabledForTests } = await import("../src/lib/backend");
    setWorkersEnabled(true);
    try {
    const g = await import("../src/lib/googleAuth");
    expect(await g.signInWithGoogle()).toEqual({ error: null });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    const url = new URL(assign.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/signin/google");
    expect(url.searchParams.get("return")).toBe("tauri://localhost");
    } finally {
      resetWorkersEnabledForTests();
      vi.unstubAllGlobals();
      vi.doUnmock("../src/lib/supabase");
    }
  });
});
