import { existsSync, readFileSync, readdirSync } from "node:fs";
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

  // Both of these have been bitten by a version production had already used
  // for an uncommitted file. plan_source went 70 → 71 → 75 (an untracked
  // review_account_otp held 71, so `db push` skipped plan_source in silence
  // and production 400'd the whole shell for days). delete_secret sat at 70
  // while production had recorded 70 for apple_billing, so it never ran at
  // all — every account deletion since quietly left its vault secrets behind
  // — and moved to 88 (2026-10-14). So pin the PROPERTY, not the number: each
  // exists exactly once, on a version of its own. Whether that version is
  // unique across the folder is tests/migrations-unique; whether it is unique
  // against PRODUCTION only `supabase migration list` can say.
  it("gives delete_secret and plan_source a version each of their own", () => {
    const deleteSecret = readdirSync("supabase/migrations").filter((f) => f.endsWith("_delete_secret.sql"));
    expect(deleteSecret).toHaveLength(1);
    expect(readFileSync(`supabase/migrations/${deleteSecret[0]}`, "utf8")).toMatch(/function public\.delete_secret/);
    expect(existsSync("supabase/functions/delete-account/index.ts")).toBe(true);
    expect(existsSync("worker/src/deleteAccount.ts")).toBe(true);
    expect(existsSync("supabase/migrations/00000000000070_plan_source.sql")).toBe(false);

    const planSource = readdirSync("supabase/migrations").filter((f) => f.endsWith("_plan_source.sql"));
    expect(planSource).toHaveLength(1);
    expect(planSource[0]).toMatch(/^\d{14}_plan_source\.sql$/);
  });
});
