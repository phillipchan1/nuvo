import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// StoreKit's appAccountToken carries the Nuvo user id into Apple's signed
// transaction, so the Worker's App Store webhook can attach a first purchase
// when the in-app `apple-iap` confirm never ran (worker/src/billing/handlers.ts
// parseAppAccountToken). The JS bridge, the Rust model and the Swift plugin
// have to agree on the field name, or the token silently never reaches Apple.

const getUser = vi.fn();
const invoke = vi.fn();
vi.mock("../src/lib/supabase", () => ({
  supabase: { auth: { getUser: () => getUser() }, functions: { invoke: vi.fn() } },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const { appAccountTokenFor, purchaseIap } = await import("../src/lib/iap");

const root = join(__dirname, "..");
const models = readFileSync(join(root, "src-tauri/plugins/nuvo-iap/src/models.rs"), "utf8");
const swift = readFileSync(join(root, "src-tauri/plugins/nuvo-iap/ios/Sources/NuvoIapPlugin.swift"), "utf8");
const USER = "3f2c1a9e-7b4d-4e2a-9c1f-0a1b2c3d4e5f";

afterEach(() => {
  getUser.mockReset();
  invoke.mockReset();
});

describe("appAccountTokenFor", () => {
  it("accepts a UUID user id and lower-cases it", () => {
    expect(appAccountTokenFor(USER.toUpperCase())).toBe(USER);
  });
  it("refuses anything that is not a UUID", () => {
    for (const v of [null, undefined, "", "user_123", 42, `${USER}x`]) {
      expect(appAccountTokenFor(v)).toBeNull();
    }
  });
});

describe("purchaseIap", () => {
  it("sends the signed-in user id as appAccountToken inside the payload", async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    invoke.mockResolvedValue({ productId: "NUVO_IAP_MONTHLY" });
    await purchaseIap("NUVO_IAP_MONTHLY");
    expect(invoke).toHaveBeenCalledWith("plugin:nuvo-iap|purchase", {
      payload: { productId: "NUVO_IAP_MONTHLY", appAccountToken: USER },
    });
  });

  it("refuses to start a purchase with no signed-in user, before StoreKit", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(purchaseIap("NUVO_IAP_MONTHLY")).rejects.toThrow(/Sign in before buying/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("the native side carries the same field", () => {
  it("models.rs deserializes appAccountToken (camelCase) as optional", () => {
    expect(models).toMatch(/rename_all = "camelCase"\)\]\s*pub struct ProductId \{[\s\S]*?pub app_account_token: Option<String>/);
  });
  it("the Swift plugin passes it to StoreKit's purchase options", () => {
    expect(swift).toContain("let appAccountToken: String?");
    expect(swift).toContain(".appAccountToken(account)");
  });
});
