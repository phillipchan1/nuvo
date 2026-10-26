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
  it.each(["active", "trialing", "past_due", "unpaid", "incomplete"] as const)(
    "refuses a Stripe subscription in %s",
    (status) => {
      expect(
        stripeSubscriptionBlocksDelete({
          status,
          plan_source: "stripe",
          stripe_subscription_id: "sub_live",
          trial_ends_at: status === "trialing" ? "2099-01-01T00:00:00Z" : null,
        }),
      ).toBe(true);
    },
  );

  it("refuses a lapsed Stripe trial that still has a subscription id", () => {
    expect(
      stripeSubscriptionBlocksDelete({
        status: "trialing",
        plan_source: "stripe",
        stripe_subscription_id: "sub_trial",
        trial_ends_at: "2020-01-01T00:00:00Z",
      }),
    ).toBe(true);
  });

  it.each(["cancelled", "canceled", "incomplete_expired"] as const)(
    "allows delete after Stripe %s",
    (status) => {
      expect(
        stripeSubscriptionBlocksDelete({
          status,
          plan_source: "stripe",
          stripe_subscription_id: "sub_old",
        }),
      ).toBe(false);
    },
  );

  it("does not block Apple-only or trial-only rows (no Stripe id)", () => {
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
        trial_ends_at: "2099-01-01T00:00:00Z",
      }),
    ).toBe(false);
    expect(stripeSubscriptionBlocksDelete(null)).toBe(false);
  });

  it("reuses planRules isEntitled / stripeStatusToPlan", () => {
    const src = readFileSync("worker/src/lib/billingRead.ts", "utf8");
    expect(src).toContain("isEntitled");
    expect(src).toContain("stripeStatusToPlan");
    expect(src).toContain('from "../../../supabase/functions/_shared/planRules.ts"');
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
