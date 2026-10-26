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

  it("disables the share block with a clear message and does not call referral-code", async () => {
    await act(async () => {
      root.render(createElement(WebBillingPane));
    });
    expect(host.textContent).toMatch(/Friend-codes still mint on today’s billing path/i);
    expect(host.textContent).not.toMatch(/Getting your code/i);
    expect(fetchReferralCode).not.toHaveBeenCalled();
  });
});
