import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_STRIPE_DELETE_MESSAGE,
  BillingLookupError,
  installBillingReaderForTests,
  readBillingSubscription,
  stripeSubscriptionBlocksDelete,
} from "../worker/src/lib/billingRead.ts";

describe("Worker delete-account Stripe gate", () => {
  it("refuses only an active Stripe subscription id", () => {
    expect(
      stripeSubscriptionBlocksDelete({
        status: "active",
        plan_source: "stripe",
        stripe_subscription_id: "sub_live",
      }),
    ).toBe(true);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "cancelled",
        plan_source: "stripe",
        stripe_subscription_id: "sub_old",
      }),
    ).toBe(false);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "active",
        plan_source: "apple",
        stripe_subscription_id: null,
      }),
    ).toBe(false);
    expect(
      stripeSubscriptionBlocksDelete({
        status: "trialing",
        stripe_subscription_id: null,
      }),
    ).toBe(false);
    expect(stripeSubscriptionBlocksDelete(null)).toBe(false);
  });

  it("tells the user to cancel in Billing first", () => {
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/Billing/);
    expect(ACTIVE_STRIPE_DELETE_MESSAGE).toMatch(/cancel/i);
  });

  it("fails closed when the Supabase billing reader is unconfigured", async () => {
    const restore = installBillingReaderForTests(null);
    try {
      await expect(
        readBillingSubscription({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, "user"),
      ).rejects.toBeInstanceOf(BillingLookupError);
    } finally {
      restore();
    }
  });

  it("the Worker wipe never holds a Stripe secret or calls Stripe", () => {
    const src = [
      readFileSync("worker/src/deleteAccount.ts", "utf8"),
      readFileSync("worker/src/lib/billingRead.ts", "utf8"),
      readFileSync("worker/src/index.ts", "utf8"),
      readFileSync("worker/src/env.ts", "utf8"),
    ].join("\n");
    expect(src).not.toMatch(/STRIPE_SECRET/);
    expect(src).not.toMatch(/stripe\.subscriptions/);
    expect(src).not.toMatch(/api\.stripe\.com/);
    expect(src).toContain("SUPABASE_URL");
    expect(src).toContain("subscriptions");
  });
});
