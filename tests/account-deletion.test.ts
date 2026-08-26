import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETE_CONFIRM,
  isAccountDeleteConfirm,
  isIgnorableStripeCancelError,
  stripeSubscriptionIdToCancel,
} from "../supabase/functions/_shared/accountDeletion.ts";

const SRC = join(import.meta.dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("isAccountDeleteConfirm", () => {
  it("accepts the exact confirm word", () => {
    expect(isAccountDeleteConfirm(ACCOUNT_DELETE_CONFIRM)).toBe(true);
  });

  it("trims surrounding space and still accepts", () => {
    expect(isAccountDeleteConfirm(`  ${ACCOUNT_DELETE_CONFIRM}  `)).toBe(true);
  });

  it("rejects a lowercase or partial type", () => {
    expect(isAccountDeleteConfirm("delete")).toBe(false);
    expect(isAccountDeleteConfirm("DELET")).toBe(false);
    expect(isAccountDeleteConfirm("DELETE forever")).toBe(false);
    expect(isAccountDeleteConfirm("")).toBe(false);
    expect(isAccountDeleteConfirm(null)).toBe(false);
  });
});

describe("stripeSubscriptionIdToCancel", () => {
  it("returns a live Stripe id", () => {
    expect(stripeSubscriptionIdToCancel({ stripe_subscription_id: "sub_123" })).toBe("sub_123");
  });

  it("skips trial / Apple-only / empty rows — we cannot cancel StoreKit", () => {
    expect(stripeSubscriptionIdToCancel({ stripe_subscription_id: null })).toBeNull();
    expect(stripeSubscriptionIdToCancel({ stripe_subscription_id: "" })).toBeNull();
    expect(stripeSubscriptionIdToCancel(null)).toBeNull();
  });
});

describe("isIgnorableStripeCancelError", () => {
  it("lets the wipe proceed when Stripe already cancelled the sub", () => {
    expect(isIgnorableStripeCancelError("No such subscription: sub_123")).toBe(true);
    expect(isIgnorableStripeCancelError("This subscription has already been canceled")).toBe(true);
  });

  it("does not swallow a real billing failure", () => {
    expect(isIgnorableStripeCancelError("Invalid API Key provided")).toBe(false);
  });
});

describe("the two doors still mount Delete account", () => {
  it("Settings → Account and both locked-screen cards import the same act", () => {
    const settings = read("components/SettingsModal.tsx");
    expect(settings).toMatch(/import\s*\{\s*DeleteAccount\s*\}\s*from\s*"\.\/account\/DeleteAccount"/);
    const accountPane = settings.slice(settings.indexOf("function AccountPane"));
    expect(accountPane).toContain("<DeleteAccount");

    const webLocked = read("components/billing/web/LockedScreen.tsx");
    const iapLocked = read("components/billing/iap/LockedScreen.tsx");
    expect(webLocked).toMatch(/import\s*\{\s*DeleteAccount\s*\}\s*from\s*"\.\.\/\.\.\/account\/DeleteAccount"/);
    expect(iapLocked).toMatch(/import\s*\{\s*DeleteAccount\s*\}\s*from\s*"\.\.\/\.\.\/account\/DeleteAccount"/);
    expect(webLocked.split("<DeleteAccount").length - 1).toBe(2);
    expect(iapLocked.split("<DeleteAccount").length - 1).toBe(2);
  });

  it("keeps master's migration 70 as delete_secret; plan_source is 71", () => {
    const seventy = readFileSync("supabase/migrations/00000000000070_delete_secret.sql", "utf8");
    expect(seventy).toMatch(/delete_secret/);
    expect(existsSync("supabase/functions/delete-account/index.ts")).toBe(true);
    expect(existsSync("supabase/migrations/00000000000070_plan_source.sql")).toBe(false);
    expect(existsSync("supabase/migrations/00000000000071_plan_source.sql")).toBe(true);
  });
});
