import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_FUNCTION_NAMES,
  edgeFunctionUrl,
  entitlementUrl,
  resetWorkersEnabledForTests,
  setWorkersEnabled,
  workerApiRoot,
  workersEnabled,
} from "../src/lib/backend";
import { resetMaintenanceCacheForTests } from "../src/lib/maintenance";

afterEach(() => {
  resetWorkersEnabledForTests();
  resetMaintenanceCacheForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runtime workersEnabled (no baked URL in tests)", () => {
  it("starts off and keeps today's function URL", () => {
    expect(workersEnabled).toBe(false);
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe(
      "https://example.supabase.co/functions/v1/agent",
    );
    expect(entitlementUrl()).toBe("");
    expect(workerApiRoot()).toBe("");
  });

  it("still falls back to Supabase when flipped but the API base is empty", () => {
    setWorkersEnabled(true);
    expect(workersEnabled).toBe(true);
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe(
      "https://example.supabase.co/functions/v1/agent",
    );
  });
});

describe("baked API URL is inert until the launch flip", () => {
  it("routes functions, entitlement, and /api only after setWorkersEnabled", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe(
      "https://example.supabase.co/functions/v1/agent",
    );
    expect(entitlementUrl()).toBe("");
    expect(workerApiRoot()).toBe("");

    setWorkersEnabled(true);
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe(
      "https://api.nuvo.day/api/agent",
    );
    expect(entitlementUrl()).toBe("https://api.nuvo.day/api/entitlement");
    expect(workerApiRoot()).toBe("https://api.nuvo.day/api");
  });

  it("never lists billing functions as rewrite targets", () => {
    expect([...BILLING_FUNCTION_NAMES].sort()).toEqual([
      "apple-iap",
      "apple-webhook",
      "iap-catalog",
      "referral-code",
      "stripe-checkout",
      "stripe-portal",
      "stripe-webhook",
    ]);
  });
});

describe("resolveLaunchBackend", () => {
  it("flips workersEnabled only when cutover_flipped is true", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ write_freeze: false, cutover_flipped: true }), { status: 200 }),
      ),
    );
    const { resolveLaunchBackend } = await import("../src/lib/maintenance");
    await resolveLaunchBackend();
    expect(workersEnabled).toBe(true);
    expect(workerApiRoot()).toBe("https://api.nuvo.day/api");
  });

  it("does not flip when maintenance says the cutover is not flipped", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ write_freeze: false, cutover_flipped: false }), { status: 200 }),
      ),
    );
    const { resolveLaunchBackend } = await import("../src/lib/maintenance");
    await resolveLaunchBackend();
    expect(workersEnabled).toBe(false);
  });

  it("fail-opens pre-flip: unreachable flag does not freeze writes and does not flip", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const { resolveLaunchBackend, writeFrozen } = await import("../src/lib/maintenance");
    await resolveLaunchBackend();
    expect(workersEnabled).toBe(false);
    await expect(writeFrozen()).resolves.toBe(false);
  });

  it("does not treat the string false as flipped", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ write_freeze: false, cutover_flipped: "false" }), { status: 200 }),
      ),
    );
    const { resolveLaunchBackend } = await import("../src/lib/maintenance");
    await resolveLaunchBackend();
    expect(workersEnabled).toBe(false);
  });

  it("keeps a sticky flip when a later poll omits cutover_flipped", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ write_freeze: false, cutover_flipped: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ write_freeze: false }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { resolveLaunchBackend, writeFrozen } = await import("../src/lib/maintenance");
    await resolveLaunchBackend();
    expect(workersEnabled).toBe(true);
    vi.useFakeTimers();
    vi.advanceTimersByTime(6_000);
    await writeFrozen();
    vi.useRealTimers();
    expect(workersEnabled).toBe(true);
  });

  it("times out a hung launch fetch and stays on Supabase", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
      ),
    );
    const { resolveLaunchBackend, writeFrozen, LAUNCH_TIMEOUT_MS } = await import("../src/lib/maintenance");
    vi.useFakeTimers();
    const pending = resolveLaunchBackend();
    await vi.advanceTimersByTimeAsync(LAUNCH_TIMEOUT_MS + 20);
    await pending;
    vi.useRealTimers();
    expect(workersEnabled).toBe(false);
    await expect(writeFrozen()).resolves.toBe(false);
  });
});
