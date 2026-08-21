#!/usr/bin/env node
/**
 * One-shot: create the shared Nuvo referral Coupon + named Promotion Codes
 * for the current beta operators. Idempotent — re-running skips existing codes.
 *
 * Usage (LIVE keys — Nuvo billing is live-only; see docs/billing-setup.md):
 *
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/create-referral-codes.mjs
 *
 * Then set the coupon id as a Supabase secret:
 *
 *   supabase secrets set STRIPE_REFERRAL_COUPON=coup_…
 *
 * Prints the one-line paste for each person.
 */

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("Set STRIPE_SECRET_KEY (live) and re-run.");
  process.exit(1);
}

const API = "https://api.stripe.com/v1";

/** Stripe form encoding: nested objects as a[b]=c. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? JSON.stringify(json));
  }
  return json;
}

/** Current Nuvo accounts as of 2026-08-21. */
const SEED = [
  { code: "PHIL", userId: "b65c1ba4-adae-4216-a77f-123a029c42bf", label: "Phil Chan" },
  { code: "ESTHER", userId: "bf8e7821-17e2-4410-a7fd-6d214b2d58e1", label: "Esther Chan" },
  { code: "DAVID", userId: "fc8949fd-de53-4e03-941f-441637e80f2d", label: "David Gunn" },
  { code: "CHUNG", userId: "6e599ec3-0b8e-4959-aa4c-98d74807522e", label: "David Chung" },
];

const COUPON_NAME = "Nuvo friend code — 20% off first 3 months";

async function ensureCoupon() {
  const listed = await stripe("GET", "/coupons?limit=100");
  const found = listed.data.find(
    (c) => c.metadata?.app === "nuvo" && c.metadata?.kind === "referral",
  );
  if (found) {
    console.log(`Coupon already exists: ${found.id}`);
    return found;
  }
  const created = await stripe("POST", "/coupons", {
    name: COUPON_NAME,
    percent_off: 20,
    duration: "repeating",
    duration_in_months: 3,
    metadata: { app: "nuvo", kind: "referral" },
  });
  console.log(`Created coupon: ${created.id}`);
  return created;
}

async function ensurePromo(couponId, seed) {
  const listed = await stripe(
    "GET",
    `/promotion_codes?code=${encodeURIComponent(seed.code)}&limit=1`,
  );
  const existing = listed.data[0];
  if (existing) {
    if (existing.metadata?.referrer_user_id !== seed.userId) {
      await stripe("POST", `/promotion_codes/${existing.id}`, {
        metadata: {
          app: "nuvo",
          kind: "referral",
          referrer_user_id: seed.userId,
        },
      });
    }
    return existing;
  }
  return stripe("POST", "/promotion_codes", {
    coupon: couponId,
    code: seed.code,
    metadata: {
      app: "nuvo",
      kind: "referral",
      referrer_user_id: seed.userId,
    },
  });
}

function sentence(code) {
  return `Your friends' code is ${code}. They get 20% off their first 3 months when they subscribe — type it at checkout, or open https://nuvo.day/?code=${code}.`;
}

const coupon = await ensureCoupon();
console.log("\n--- Set this Supabase secret ---");
console.log(`STRIPE_REFERRAL_COUPON=${coupon.id}\n`);

console.log("--- Texts to send ---\n");
for (const seed of SEED) {
  const promo = await ensurePromo(coupon.id, seed);
  console.log(`${seed.label} (${promo.code}):`);
  console.log(`  ${sentence(promo.code)}`);
  console.log(`  stripe: ${promo.id}\n`);
}

console.log("--- Watch redemptions ---");
console.log("Stripe Dashboard → Product catalog → Coupons → open this coupon → redemptions.");
console.log(`Coupon id: ${coupon.id}`);
