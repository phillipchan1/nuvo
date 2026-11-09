import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiBaseUrl,
  apiConfigured,
  edgeFunctionUrl,
  entitlementUrl,
  resetWorkersEnabledForTests,
  setWorkersEnabled,
  workersEnabled,
} from "../src/lib/backend";

afterEach(() => {
  vi.unstubAllEnvs();
  resetWorkersEnabledForTests();
});

describe("workers backend flag (default / production)", () => {
  it("is off when VITE_API_BASE_URL is unset", () => {
    expect(workersEnabled).toBe(false);
    expect(apiConfigured()).toBe(false);
    expect(apiBaseUrl()).toBe("");
  });

  it("keeps today's agent URL when the flag is off", () => {
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe(
      "https://example.supabase.co/functions/v1/agent",
    );
  });

  it("does not point the entitlement read at the Worker when the flag is off", () => {
    expect(entitlementUrl()).toBe("");
  });
});

describe("baked Worker URL, cutover not flipped", () => {
  it("stays on Supabase until the runtime flip, then switches", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day/api");
    expect(apiConfigured()).toBe(true);
    expect(apiBaseUrl()).toBe("https://api.nuvo.day/api");
    expect(workersEnabled).toBe(false);
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe(
      "https://example.supabase.co/functions/v1/agent",
    );
    expect(entitlementUrl()).toBe("");

    setWorkersEnabled(true);
    expect(workersEnabled).toBe(true);
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe("https://api.nuvo.day/api/agent");
    expect(entitlementUrl()).toBe("https://api.nuvo.day/api/entitlement");

    setWorkersEnabled(false);
    expect(edgeFunctionUrl("https://example.supabase.co", "agent")).toBe(
      "https://example.supabase.co/functions/v1/agent",
    );
  });
});
