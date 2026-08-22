import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appleNotificationToPlan,
  isEntitled,
  isOurIapProduct,
  planRowPatch,
  shouldWritePlan,
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
