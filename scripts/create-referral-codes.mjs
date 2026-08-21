#!/usr/bin/env node
/**
 * Launch / re-seed Nuvo friend-codes (LIVE Stripe).
 *
 * Offer (D-113):
 *   Friend  → 50% off first invoice (Coupon duration: once)
 *   Sharer  → one free month ($29 Customer Balance) when friend *pays*,
 *             capped at 6 months outstanding credit (enforced in stripe-webhook)
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/create-referral-codes.mjs
 *
 * Then (Grokbot / Phil):
 *   supabase secrets set STRIPE_REFERRAL_COUPON=coup_… --project-ref ebibzojtkzkphykznomv
 *   supabase functions deploy stripe-checkout stripe-webhook referral-code --project-ref ebibzojtkzkphykznomv
 *
 * Add webhook event if missing: invoice.paid
 * (Developers → Webhooks → Nuvo endpoint → + invoice.paid)
 */

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("Set STRIPE_SECRET_KEY (live) and re-run.");
  process.exit(1);
}

const API = "https://api.stripe.com/v1";

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
  if (!res.ok) throw new Error(json?.error?.message ?? JSON.stringify(json));
  return json;
}

const SEED = [
  { code: "PHIL", userId: "b65c1ba4-adae-4216-a77f-123a029c42bf", label: "Phil Chan" },
  { code: "ESTHER", userId: "bf8e7821-17e2-4410-a7fd-6d214b2d58e1", label: "Esther Chan" },
  { code: "DAVID", userId: "fc8949fd-de53-4e03-941f-441637e80f2d", label: "David Gunn" },
  { code: "CHUNG", userId: "6e599ec3-0b8e-4959-aa4c-98d74807522e", label: "David Chung" },
];

const COUPON_NAME = "Nuvo friend code — 50% off first invoice";

function isLaunchCoupon(c) {
  return (
    c.metadata?.app === "nuvo" &&
    c.metadata?.kind === "referral" &&
    Number(c.percent_off) === 50 &&
    c.duration === "once"
  );
}

async function ensureCoupon() {
  const listed = await stripe("GET", "/coupons?limit=100");
  const found = listed.data.find(isLaunchCoupon);
  if (found) {
    console.log(`Coupon already exists: ${found.id}`);
    return found;
  }
  const legacy = listed.data.find(
    (c) => c.metadata?.app === "nuvo" && c.metadata?.kind === "referral" && !isLaunchCoupon(c),
  );
  if (legacy) {
    console.log(
      `Note: older referral coupon ${legacy.id} (${legacy.percent_off}% / ${legacy.duration}) still exists — leave it; new promos attach to the 50%-once coupon.`,
    );
  }
  const created = await stripe("POST", "/coupons", {
    name: COUPON_NAME,
    percent_off: 50,
    duration: "once",
    metadata: { app: "nuvo", kind: "referral", version: "50_once" },
  });
  console.log(`Created coupon: ${created.id}`);
  return created;
}

async function ensurePromo(couponId, seed) {
  const listed = await stripe(
    "GET",
    `/promotion_codes?code=${encodeURIComponent(seed.code)}&limit=10`,
  );
  // Prefer an active promo already on this coupon.
  const onCoupon = listed.data.find((p) => p.coupon?.id === couponId || p.coupon === couponId);
  if (onCoupon) {
    if (onCoupon.metadata?.referrer_user_id !== seed.userId) {
      await stripe("POST", `/promotion_codes/${onCoupon.id}`, {
        metadata: {
          app: "nuvo",
          kind: "referral",
          referrer_user_id: seed.userId,
        },
      });
    }
    return onCoupon;
  }
  // Code may exist on an old coupon — deactivate and recreate on the launch coupon.
  for (const p of listed.data) {
    if (p.active) {
      await stripe("POST", `/promotion_codes/${p.id}`, { active: false });
      console.log(`  deactivated old promo ${p.id} for code ${seed.code}`);
    }
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
  return `Your friends' code is ${code}. They get 50% off their first month when they subscribe — and you get a free month when they pay (up to 6). Share https://nuvo.day/?code=${code} or have them type ${code} at checkout.`;
}

const coupon = await ensureCoupon();
console.log("\n=== GROKBOT: set this Supabase secret ===");
console.log(`supabase secrets set STRIPE_REFERRAL_COUPON=${coupon.id} --project-ref ebibzojtkzkphykznomv\n`);

console.log("=== Texts to send (or tell them: Settings → Billing) ===\n");
for (const seed of SEED) {
  const promo = await ensurePromo(coupon.id, seed);
  console.log(`${seed.label} (${promo.code}):`);
  console.log(`  ${sentence(promo.code)}`);
  console.log(`  stripe: ${promo.id}\n`);
}

console.log("=== Also verify ===");
console.log("1. Webhook endpoint includes event: invoice.paid");
console.log("2. Deploy: supabase functions deploy stripe-checkout stripe-webhook referral-code --project-ref ebibzojtkzkphykznomv");
console.log(`3. Coupon id: ${coupon.id}`);
