import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { billingViaWorker, edgeFunctionUrl, workersEnabled } from "../src/lib/backend";
import { BILLING_PROXY_NAMES } from "../src/lib/billingInvoke";

const ROOT = join(import.meta.dirname, "..");

describe("billingViaWorker hook (the #117 switch)", () => {
  it("is false on today's path so billing stays on Supabase", () => {
    expect(workersEnabled).toBe(false);
    expect(billingViaWorker()).toBe(false);
    expect(edgeFunctionUrl("https://example.supabase.co", "apple-iap")).toBe(
      "https://example.supabase.co/functions/v1/apple-iap",
    );
  });

  it("is the same predicate as workersEnabled — #117's flip flips this", () => {
    const src = readFileSync(join(ROOT, "src/lib/backend.ts"), "utf8");
    expect(src).toMatch(/export function billingViaWorker\(\): boolean \{\s*return workersEnabled;/);
    expect(src).toMatch(/#117/);
  });
});

describe("client billing calls use the hook", () => {
  it("stripe + IAP go through invokeBilling", () => {
    const stripe = readFileSync(join(ROOT, "src/lib/stripeBilling.ts"), "utf8");
    const iap = readFileSync(join(ROOT, "src/lib/iap.ts"), "utf8");
    expect(stripe).toMatch(/invokeBilling/);
    expect(stripe).not.toMatch(/supabase\.functions\.invoke/);
    expect(iap).toMatch(/invokeBilling\("apple-iap"/);
    expect(iap).not.toMatch(/supabase\.functions\.invoke/);
  });

  it("names the four proxied functions and not the webhooks", () => {
    expect([...BILLING_PROXY_NAMES].sort()).toEqual(
      ["apple-iap", "referral-code", "stripe-checkout", "stripe-portal"].sort(),
    );
    const invoke = readFileSync(join(ROOT, "src/lib/billingInvoke.ts"), "utf8");
    expect(invoke).not.toMatch(/stripe-webhook|apple-webhook/);
    expect(invoke).toMatch(/billingViaWorker\(\)/);
  });
});

describe("invokeBilling before the flip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses supabase.functions.invoke when the hook is off", async () => {
    vi.resetModules();
    const invoke = vi.fn(async () => ({ data: { url: "https://checkout.test" }, error: null }));
    vi.doMock("../src/lib/backend", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/backend")>("../src/lib/backend");
      return { ...actual, billingViaWorker: () => false, workersEnabled: false };
    });
    vi.doMock("../src/lib/supabase", () => ({
      functionUrl: (name: string) => `https://example.supabase.co/functions/v1/${name}`,
      supabase: { functions: { invoke } },
    }));
    const { invokeBilling } = await import("../src/lib/billingInvoke");
    const got = await invokeBilling("stripe-checkout", { plan: "monthly" });
    expect(invoke).toHaveBeenCalledWith("stripe-checkout", { body: { plan: "monthly" } });
    expect(got.data).toEqual({ url: "https://checkout.test" });
    expect(got.error).toBeNull();
  });
});
