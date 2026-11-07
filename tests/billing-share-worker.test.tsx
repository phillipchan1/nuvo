/** @vitest-environment jsdom */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchReferralCode = vi.fn();

vi.mock("../src/lib/backend", () => ({
  workersEnabled: true,
}));

vi.mock("../src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: {
      user_id: "u1",
      status: "trialing",
      plan: "trialing",
      plan_source: null,
      trial_ends_at: "2026-11-09T00:00:00Z",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      referral_code: null,
      referral_uses: 0,
      referral_credits_earned: 0,
      entitled: true,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("../src/lib/stripeBilling", () => ({
  fetchReferralCode: () => fetchReferralCode(),
  fetchPortalUrl: vi.fn(),
  openBillingUrl: vi.fn(),
}));

vi.mock("../src/components/billing/web/UpgradeModal", () => ({
  WebUpgradeModal: () => null,
}));

import { WebBillingPane } from "../src/components/billing/web/BillingPane";

describe("Share Nuvo on the Worker path", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    fetchReferralCode.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  // referral-code is ported (worker/src/billing): on the Worker path the share
  // block mints through the same call, which `workerRoute` sends to the twin.
  it("mints the share code through referral-code, same as the Supabase path", async () => {
    fetchReferralCode.mockResolvedValue("PHIL-K7RM");
    await act(async () => {
      root.render(createElement(WebBillingPane));
    });
    expect(fetchReferralCode).toHaveBeenCalledTimes(1);
    expect(host.textContent).toMatch(/PHIL-K7RM/);
    expect(host.textContent).not.toMatch(/Friend-codes still mint on today’s billing path/i);
  });
});
