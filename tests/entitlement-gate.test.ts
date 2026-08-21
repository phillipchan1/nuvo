import { describe, expect, it } from "vitest";
import {
  interpretSubscriptionRead,
  resolveEntitlementView,
  type Subscription,
} from "../src/lib/subscription";

const paid: Subscription = {
  user_id: "u1",
  status: "active",
  trial_ends_at: "2026-08-01T00:00:00Z",
  stripe_customer_id: "cus_x",
  stripe_subscription_id: "sub_x",
  price_id: "price_x",
  current_period_end: "2026-09-01T00:00:00Z",
  cancel_at_period_end: false,
  entitled: true,
};

const lapsed: Subscription = { ...paid, status: "trialing", entitled: false };

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
});
