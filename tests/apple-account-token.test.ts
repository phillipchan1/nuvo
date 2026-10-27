import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appleWebhookUserId,
  parseAppAccountToken,
} from "../supabase/functions/_shared/appleAccount.ts";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("parseAppAccountToken", () => {
  it("accepts a hyphenated UUID", () => {
    expect(parseAppAccountToken(USER)).toBe(USER);
    expect(parseAppAccountToken(USER.toUpperCase())).toBe(USER);
  });

  it("accepts Apple's compact 32-hex form", () => {
    expect(parseAppAccountToken(USER.replace(/-/g, ""))).toBe(USER);
  });

  it("rejects junk", () => {
    expect(parseAppAccountToken(null)).toBeNull();
    expect(parseAppAccountToken("")).toBeNull();
    expect(parseAppAccountToken("not-a-uuid")).toBeNull();
    expect(parseAppAccountToken(1234)).toBeNull();
  });
});

describe("appleWebhookUserId", () => {
  it("maps the token when no originalTransactionId link exists", () => {
    expect(
      appleWebhookUserId({
        existingUserIdByOriginalTransaction: null,
        appAccountToken: USER,
      }),
    ).toBe(USER);
  });

  it("does not remap a row already linked to the transaction", () => {
    expect(
      appleWebhookUserId({
        existingUserIdByOriginalTransaction: "11111111-1111-4111-8111-111111111111",
        appAccountToken: USER,
      }),
    ).toBeUndefined();
  });

  it("returns nothing when there is no token and no link", () => {
    expect(
      appleWebhookUserId({
        existingUserIdByOriginalTransaction: null,
        appAccountToken: null,
      }),
    ).toBeUndefined();
  });
});

describe("StoreKit + webhook wire the token", () => {
  const root = join(import.meta.dirname, "..");

  it("JS purchase sends appAccountToken from the session user id", () => {
    const src = readFileSync(join(root, "src/lib/iap.ts"), "utf8");
    expect(src).toMatch(/currentUserId/);
    expect(src).toMatch(/appAccountToken/);
    expect(src).toMatch(/UUID_RE\.test\(appAccountToken\)/);
  });

  it("Swift Product.purchase sets StoreKit appAccountToken", () => {
    const swift = readFileSync(
      join(root, "src-tauri/plugins/nuvo-iap/ios/Sources/NuvoIapPlugin.swift"),
      "utf8",
    );
    expect(swift).toMatch(/appAccountToken/);
    expect(swift).toMatch(/\.appAccountToken\(/);
    expect(swift).toMatch(/UUID\(uuidString:/);
  });

  it("apple-webhook maps appAccountToken only when no existing link", () => {
    const src = readFileSync(join(root, "supabase/functions/apple-webhook/index.ts"), "utf8");
    expect(src).toMatch(/appleWebhookUserId/);
    expect(src).toMatch(/appAccountToken/);
    expect(src).toMatch(/apple_original_transaction_id/);
    expect(src).toContain("applyPlanUpdate");
  });
});
