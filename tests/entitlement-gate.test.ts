import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  interpretSubscriptionRead,
  isEntitled,
  resolveEntitlementView,
  type Subscription,
} from "../src/lib/subscription";

const paid: Subscription = {
  user_id: "u1",
  status: "active",
  plan: "active",
  plan_source: "stripe",
  trial_ends_at: "2026-08-01T00:00:00Z",
  stripe_customer_id: "cus_x",
  stripe_subscription_id: "sub_x",
  price_id: "price_x",
  current_period_end: "2026-09-01T00:00:00Z",
  cancel_at_period_end: false,
  referral_code: null,
  entitled: true,
};

const lapsed: Subscription = { ...paid, status: "trialing", plan: "trialing", entitled: false };

describe("interpretSubscriptionRead", () => {
  it("returns a real row", () => {
    expect(interpretSubscriptionRead(paid, { hasSession: true, alreadyRetried: false })).toEqual({
      action: "return",
      row: paid,
    });
  });

  it("returns null when there is no session — signed out, not a paywall", () => {
    expect(interpretSubscriptionRead(null, { hasSession: false, alreadyRetried: false })).toEqual({
      action: "return",
      row: null,
    });
  });

  it("retries a null read with a live session once", () => {
    expect(interpretSubscriptionRead(null, { hasSession: true, alreadyRetried: false })).toEqual({
      action: "retry",
    });
  });

  it("fails a second null read with a live session instead of treating it as cancelled", () => {
    expect(interpretSubscriptionRead(null, { hasSession: true, alreadyRetried: true })).toEqual({
      action: "fail",
    });
  });
});

describe("resolveEntitlementView", () => {
  const base = {
    subPending: false,
    subError: false,
    subscription: undefined as Subscription | null | undefined,
    checkoutPending: false,
    wasEntitled: false,
  };

  it("loads while the first fetch is in flight and we have nothing to trust", () => {
    expect(resolveEntitlementView({ ...base, subPending: true })).toBe("loading");
  });

  it("opens immediately on last launch's hint instead of blocking on the network", () => {
    expect(resolveEntitlementView({ ...base, subPending: true, wasEntitled: true })).toBe("open");
  });

  it("does not unmount a paying account when the subscription check errors", () => {
    expect(resolveEntitlementView({ ...base, subError: true, wasEntitled: true })).toBe("open");
  });

  it("does not unmount when the last successful row is still in memory", () => {
    expect(resolveEntitlementView({ ...base, subError: true, subscription: paid })).toBe("open");
  });

  it("shows the verify card only when there is nothing to trust", () => {
    expect(resolveEntitlementView({ ...base, subError: true })).toBe("verify-error");
  });

  it("locks only on an actual not-entitled row", () => {
    expect(resolveEntitlementView({ ...base, subscription: lapsed })).toBe("locked");
  });

  it("opens a paid row", () => {
    expect(resolveEntitlementView({ ...base, subscription: paid })).toBe("open");
  });

  it("waits after checkout only when we cannot yet trust the account", () => {
    expect(resolveEntitlementView({ ...base, checkoutPending: true })).toBe("loading");
    expect(resolveEntitlementView({ ...base, checkoutPending: true, wasEntitled: true })).toBe("open");
  });

  it("opens an Apple-paid row the same as a Stripe-paid row", () => {
    const apple: Subscription = { ...paid, plan_source: "apple", stripe_customer_id: null, stripe_subscription_id: null };
    expect(isEntitled(apple)).toBe(true);
    expect(resolveEntitlementView({ ...base, subscription: apple })).toBe("open");
  });
});

/**
 * The subscription read is the gate in front of the ENTIRE shell — nothing
 * renders until it answers. So it must only ever ask for things that are
 * physically there. `entitled` and `plan` are Postgres FUNCTIONS, not columns;
 * PostgREST 400s the whole select (42703) when one is missing rather than
 * omitting the field, so a migration that hasn't landed does not degrade the
 * billing pane — it takes down the app on every device at once. App code never
 * reads either: `isEntitled` / `planOf` in _shared/planRules.ts both fall back
 * to `status`, which is a real column, and `plan_source` is a real column too.
 */
describe("the gating subscription select", () => {
  const source = readFileSync(new URL("../src/hooks/useSubscription.ts", import.meta.url).pathname, "utf8");

  it("asks PostgREST only for physical columns", () => {
    const selects = [...source.matchAll(/\.select\((["'`])([^"'`]*)\1\)/g)].map((m) => m[2]);
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      const fields = select.split(",").map((f) => f.trim()).filter(Boolean);
      for (const computed of ["entitled", "is_entitled", "plan"]) {
        expect(
          fields,
          `useSubscription selects the computed alias \`${computed}\`. It is a SQL ` +
            "function, so a database missing it 400s this query and the whole app " +
            "goes down. Read the rule from _shared/planRules.ts instead.",
        ).not.toContain(computed);
      }
    }
  });
});
