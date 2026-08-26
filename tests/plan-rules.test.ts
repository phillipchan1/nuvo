import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appleNotificationToPlan,
  configuredIapProductIds,
  isEntitled,
  isOurIapProduct,
  planRowPatch,
  shouldWritePlan,
  storeKitProductIds,
  stripeStatusToPlan,
} from "../supabase/functions/_shared/planRules.ts";

const now = new Date("2026-08-22T12:00:00Z");

describe("isEntitled", () => {
  it("is true for active regardless of source", () => {
    expect(isEntitled({ plan: "active", trial_ends_at: "2020-01-01T00:00:00Z" }, now)).toBe(true);
    expect(isEntitled({ status: "active" }, now)).toBe(true);
  });

  it("is true for a live trial and false once it lapses", () => {
    expect(isEntitled({ plan: "trialing", trial_ends_at: "2026-08-23T00:00:00Z" }, now)).toBe(true);
    expect(isEntitled({ plan: "trialing", trial_ends_at: "2026-08-21T00:00:00Z" }, now)).toBe(false);
  });

  it("is false for cancelled and past_due", () => {
    expect(isEntitled({ plan: "cancelled" }, now)).toBe(false);
    expect(isEntitled({ plan: "past_due" }, now)).toBe(false);
  });

  it("is false for a missing row", () => {
    expect(isEntitled(null, now)).toBe(false);
  });
});

describe("stripeStatusToPlan", () => {
  it("maps Stripe statuses onto the one plan vocabulary", () => {
    expect(stripeStatusToPlan("active")).toBe("active");
    expect(stripeStatusToPlan("past_due")).toBe("past_due");
    expect(stripeStatusToPlan("canceled")).toBe("cancelled");
    expect(stripeStatusToPlan("trialing")).toBe("past_due");
  });
});

describe("appleNotificationToPlan", () => {
  it("keeps renewals and new subs active", () => {
    expect(appleNotificationToPlan("SUBSCRIBED")?.plan).toBe("active");
    expect(appleNotificationToPlan("DID_RENEW")?.plan).toBe("active");
  });

  it("treats grace period as still entitled (active)", () => {
    expect(appleNotificationToPlan("DID_FAIL_TO_RENEW", "GRACE_PERIOD")).toEqual({
      plan: "active",
      cancelAtPeriodEnd: false,
    });
  });

  it("maps expiry and refund to cancelled", () => {
    expect(appleNotificationToPlan("EXPIRED")?.plan).toBe("cancelled");
    expect(appleNotificationToPlan("REFUND")?.plan).toBe("cancelled");
  });

  it("ignores unknown types", () => {
    expect(appleNotificationToPlan("PRICE_INCREASE")).toBeNull();
  });
});

describe("shouldWritePlan / planRowPatch", () => {
  it("lets the same rail update its own row", () => {
    expect(shouldWritePlan({ plan: "active", planSource: "stripe" }, { plan: "cancelled", planSource: "stripe" })).toBe(
      true,
    );
  });

  it("does not let Apple expiry demote an active Stripe row", () => {
    expect(shouldWritePlan({ plan: "active", planSource: "stripe" }, { plan: "cancelled", planSource: "apple" })).toBe(
      false,
    );
    const patch = planRowPatch(
      { plan: "active", planSource: "stripe" },
      { plan: "cancelled", planSource: "apple", appleOriginalTransactionId: "orig" },
    );
    expect(patch.status).toBeUndefined();
    expect(patch.apple_original_transaction_id).toBe("orig");
  });

  it("lets a new Apple purchase take over a trial", () => {
    expect(shouldWritePlan({ plan: "trialing", planSource: null }, { plan: "active", planSource: "apple" })).toBe(true);
    const patch = planRowPatch(
      { plan: "trialing", planSource: null },
      { plan: "active", planSource: "apple", appleProductId: "NUVO_IAP_MONTHLY" },
    );
    expect(patch.status).toBe("active");
    expect(patch.plan_source).toBe("apple");
  });
});

describe("isOurIapProduct", () => {
  const env = { NUVO_IAP_MONTHLY: "NUVO_IAP_MONTHLY", NUVO_IAP_ANNUAL: "NUVO_IAP_ANNUAL" };
  it("accepts only configured identifiers", () => {
    expect(isOurIapProduct("NUVO_IAP_MONTHLY", env)).toBe(true);
    expect(isOurIapProduct("com.other.app.pro", env)).toBe(false);
  });

  it("defaults product() ids to the Connect strings", () => {
    expect(configuredIapProductIds({})).toEqual({
      monthly: "NUVO_IAP_MONTHLY",
      annual: "NUVO_IAP_ANNUAL",
    });
  });

  it("does not pass Apple internal IDs to product()", () => {
    expect(
      configuredIapProductIds({ NUVO_IAP_MONTHLY: "6804259519", NUVO_IAP_ANNUAL: "6804258767" }),
    ).toEqual({ monthly: "NUVO_IAP_MONTHLY", annual: "NUVO_IAP_ANNUAL" });
    expect(storeKitProductIds(["NUVO_IAP_MONTHLY", "6804259519", "6804258767"])).toEqual([
      "NUVO_IAP_MONTHLY",
    ]);
  });
});

const KERNEL = "supabase/functions/_shared/planRules.ts";
const OWNED = ["isEntitled", "shouldWritePlan", "planRowPatch", "appleNotificationToPlan", "stripeStatusToPlan"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("isEntitled is one function", () => {
  const files = [...sourceFiles("src"), ...sourceFiles("supabase/functions")].filter(
    (f) => !f.endsWith("planRules.ts"),
  );

  for (const rule of OWNED) {
    it(`no surface redefines ${rule}`, () => {
      const offenders = files.filter((f) => {
        const src = readFileSync(f, "utf8");
        return new RegExp(`(function|const|let)\\s+${rule}\\b\\s*[=(]`).test(src);
      });
      expect(offenders, `re-implements ${rule}; import it from ${KERNEL}`).toEqual([]);
    });
  }

  it("both webhooks call applyPlanUpdate", () => {
    expect(readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8")).toContain("applyPlanUpdate");
    expect(readFileSync("supabase/functions/apple-webhook/index.ts", "utf8")).toContain("applyPlanUpdate");
    expect(readFileSync("supabase/functions/apple-iap/index.ts", "utf8")).toContain("applyPlanUpdate");
  });
});

describe("one trial, both rails", () => {
  it("handle_new_user still grants the 14-day trial on subscriptions", () => {
    const src = readFileSync("supabase/migrations/00000000000042_domain_seed_after_billing.sql", "utf8");
    expect(src).toMatch(/insert into public\.subscriptions \(user_id, status, trial_ends_at\)/);
    expect(src).toContain("interval '14 days'");
  });

  it("does not add a second trial table", () => {
    const mig = readFileSync("supabase/migrations/00000000000071_plan_source.sql", "utf8");
    expect(mig).not.toMatch(/create table\s+\w*trial/i);
  });

  it("Stripe Checkout does not grant a trial", () => {
    const src = readFileSync("supabase/functions/stripe-checkout/index.ts", "utf8");
    expect(src).not.toMatch(/trial_period_days/);
  });

  it("docs and env examples name the Connect SKUs", () => {
    const setup = readFileSync("docs/billing-setup.md", "utf8");
    const env = readFileSync(".env.example", "utf8");
    for (const src of [setup, env]) {
      expect(src).toContain("22327993");
      expect(src).toContain("6804259519");
      expect(src).toContain("6804258767");
      expect(src).toContain("NUVO_IAP_MONTHLY");
      expect(src).toContain("NUVO_IAP_ANNUAL");
    }
  });

  it("no StoreKit introductory-offer implementation in code", () => {
    const files = [...sourceFiles("src"), ...sourceFiles("supabase/functions")];
    const offenders = files.filter((f) =>
      /introductoryOffer|SKPaymentDiscount|promotionalOffer/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
    const swift = readFileSync("src-tauri/plugins/nuvo-iap/ios/Sources/NuvoIapPlugin.swift", "utf8");
    expect(swift).not.toMatch(/introductoryOffer|SKPaymentDiscount|promotionalOffer/);
  });
});
