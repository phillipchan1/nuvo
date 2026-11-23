import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiBaseUrl,
  apiConfigured,
  calendarOauthStartHref,
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

  it("does not invent a Supabase function URL when nothing is baked", () => {
    expect(edgeFunctionUrl("agent")).toBe("");
  });

  it("does not point the entitlement read at the Worker when the flag is off", () => {
    expect(entitlementUrl()).toBe("");
  });
});

describe("baked Worker URL", () => {
  it("serves function URLs from the baked base even before the REST flip", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day/api");
    expect(apiConfigured()).toBe(true);
    expect(apiBaseUrl()).toBe("https://api.nuvo.day/api");
    expect(workersEnabled).toBe(false);
    expect(edgeFunctionUrl("agent")).toBe("https://api.nuvo.day/api/agent");
    expect(entitlementUrl()).toBe("");

    setWorkersEnabled(true);
    expect(workersEnabled).toBe(true);
    expect(edgeFunctionUrl("agent")).toBe("https://api.nuvo.day/api/agent");
    expect(entitlementUrl()).toBe("https://api.nuvo.day/api/entitlement");

    setWorkersEnabled(false);
    expect(edgeFunctionUrl("agent")).toBe("https://api.nuvo.day/api/agent");
  });
});

describe("calendarOauthStartHref", () => {
  it("points Google start at the Worker /api twin with the session token in query", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day/api");
    const href = calendarOauthStartHref("google", "ba-token", "https://app.nuvo.day");
    expect(href).toBe(
      "https://api.nuvo.day/api/google-oauth?action=start&token=ba-token&redirect=https%3A%2F%2Fapp.nuvo.day",
    );
  });

  it("hides Microsoft 365 (Worker route is 503 m365_disabled) and unknown providers", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.nuvo.day/api");
    expect(calendarOauthStartHref("m365", "ba-token", "https://app.nuvo.day")).toBeNull();
    expect(calendarOauthStartHref("icloud", "ba-token", "https://app.nuvo.day")).toBeNull();
    expect(calendarOauthStartHref("ics", "ba-token", "https://app.nuvo.day")).toBeNull();
  });

  it("returns null when the API base is not baked, rather than a dead host", () => {
    expect(calendarOauthStartHref("google", "ba-token", "https://app.nuvo.day")).toBeNull();
  });
});
