import { describe, expect, it } from "vitest";
import { apiBaseUrl, edgeFunctionUrl, entitlementUrl, workersEnabled } from "../src/lib/backend";

describe("workers backend flag (default / production)", () => {
  it("is off when VITE_API_BASE_URL is unset", () => {
    expect(workersEnabled).toBe(false);
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
