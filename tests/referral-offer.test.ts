import { describe, expect, it } from "vitest";
import {
  REFERRAL_MAX_OUTSTANDING_CENTS,
  REFERRAL_MONTHLY_CREDIT_CENTS,
  monthsCreditRemaining,
  outstandingCreditCents,
} from "../src/lib/referralOffer";

describe("outstandingCreditCents", () => {
  it("treats Stripe negative balance as credit", () => {
    expect(outstandingCreditCents(-2900)).toBe(2900);
    expect(outstandingCreditCents(0)).toBe(0);
    expect(outstandingCreditCents(500)).toBe(0); // they owe us
  });
});

describe("monthsCreditRemaining", () => {
  it("allows six free months from empty", () => {
    expect(monthsCreditRemaining(0)).toBe(6);
  });
  it("stops at the cap", () => {
    expect(monthsCreditRemaining(-REFERRAL_MAX_OUTSTANDING_CENTS)).toBe(0);
    expect(monthsCreditRemaining(-(REFERRAL_MAX_OUTSTANDING_CENTS - 100))).toBe(0);
  });
  it("counts remaining whole months", () => {
    expect(monthsCreditRemaining(-REFERRAL_MONTHLY_CREDIT_CENTS)).toBe(5);
    expect(monthsCreditRemaining(-(REFERRAL_MONTHLY_CREDIT_CENTS * 5))).toBe(1);
  });
});
