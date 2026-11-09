import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// StoreKit's appAccountToken carries the Nuvo user id into Apple's signed
// transaction, so the Worker's App Store webhook can attach a first purchase
// when the in-app `apple-iap` confirm never ran (worker/src/billing/handlers.ts
// parseAppAccountToken). The JS bridge, the Rust model and the Swift plugin
// have to agree on the field name, or the token silently never reaches Apple.

const getSession = vi.fn();
const getUser = vi.fn();
const invoke = vi.fn();
const fnInvoke = vi.fn();
vi.mock("../src/lib/supabase", () => ({
  supabase: { auth: { getSession: () => getSession(), getUser: () => getUser() }, functions: { invoke: (...a: unknown[]) => fnInvoke(...a) } },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const { appAccountTokenFor, confirmApplePurchase, purchaseIap } = await import("../src/lib/iap");

const root = join(__dirname, "..");
const models = readFileSync(join(root, "src-tauri/plugins/nuvo-iap/src/models.rs"), "utf8");
const swift = readFileSync(join(root, "src-tauri/plugins/nuvo-iap/ios/Sources/NuvoIapPlugin.swift"), "utf8");
const USER = "3f2c1a9e-7b4d-4e2a-9c1f-0a1b2c3d4e5f";

afterEach(() => {
  getSession.mockReset();
  getUser.mockReset();
  invoke.mockReset();
  fnInvoke.mockReset();
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
    getSession.mockResolvedValue({ data: { session: { user: { id: USER } } }, error: null });
    invoke.mockResolvedValue({ productId: "NUVO_IAP_MONTHLY" });
    await purchaseIap("NUVO_IAP_MONTHLY");
    expect(invoke).toHaveBeenCalledWith("plugin:nuvo-iap|purchase", {
      payload: { productId: "NUVO_IAP_MONTHLY", appAccountToken: USER },
    });
  });

  it("refuses to start a purchase with no signed-in user, before StoreKit", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(purchaseIap("NUVO_IAP_MONTHLY")).rejects.toThrow(/Sign in before buying/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads the local session, never the network user (QA2 #129 S1)", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: USER } } }, error: null });
    invoke.mockResolvedValue({ productId: "NUVO_IAP_MONTHLY" });
    await purchaseIap("NUVO_IAP_MONTHLY");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("a session read error is a retry, not a sign-in prompt", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: new Error("fetch failed") });
    await expect(purchaseIap("NUVO_IAP_MONTHLY")).rejects.toThrow(/connection/);
    await expect(purchaseIap("NUVO_IAP_MONTHLY")).rejects.not.toThrow(/Sign in/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("confirmApplePurchase", () => {
  it("sends StoreKit's signed transaction and the transaction id to apple-iap", async () => {
    fnInvoke.mockResolvedValue({ error: null });
    await confirmApplePurchase({
      productId: "NUVO_IAP_MONTHLY",
      transactionId: "2000000001",
      originalTransactionId: "1000000001",
      jwsRepresentation: "h.p.s",
    });
    expect(fnInvoke).toHaveBeenCalledWith("apple-iap", {
      body: expect.objectContaining({ jwsRepresentation: "h.p.s", transactionId: "2000000001" }),
    });
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
  it("purchase and restore both hand back the verified transaction's JWS", () => {
    expect(models).toMatch(/pub struct IapPurchase \{[\s\S]*?pub jws_representation: Option<String>/);
    expect(swift).toContain("let jwsRepresentation: String?");
    expect(swift).toContain("payload(for: transaction, jws: verification.jwsRepresentation)");
    expect(swift).toContain("payload(for: transaction, jws: entitlement.jwsRepresentation)");
  });
});
