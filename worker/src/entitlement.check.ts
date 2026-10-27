// Worker entitlement check: lookup is always the preserved user_id.
// Run: node --experimental-strip-types worker/src/entitlement.check.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EntitlementUnavailableError,
  entitlementOf,
  entitlementResponseBody,
  fetchSubscriptionByUserId,
  installSubscriptionFetcherForTests,
  readEntitlement,
  subscriptionQueryUrl,
  type SubscriptionColumns,
} from "./entitlement.ts";
import { compareAuthIds, compareEntitlementParity } from "./entitlementParity.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "entitlement.ts"), "utf8");
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
const now = new Date("2026-10-26T19:00:00Z");
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

ok(!/from ["']stripe["']/.test(src), "entitlement.ts does not import the Stripe SDK");
ok(!/STRIPE_SECRET|stripe\.subscriptions|StoreKit/.test(src), "entitlement.ts does not call Stripe or StoreKit");
ok(!/apple-iap|apple-webhook|stripe-webhook|stripe-checkout|stripe-portal/.test(src), "entitlement.ts does not import billing writers");
ok(!/from\(["']subscriptions["']\)/.test(src), "entitlement.ts does not use the supabase-js writer client");
ok(/user_id/.test(src) && /eq\./.test(src), "lookup filter is user_id=eq.<id>");
ok(!/email=/.test(src), "lookup never filters by email");
ok(/readEntitlement/.test(indexSrc), "index.ts calls readEntitlement");
ok(/\/api\/entitlement/.test(indexSrc), "index.ts serves GET /api/entitlement");
ok(!/STRIPE_SECRET/.test(indexSrc), "Worker router does not read a Stripe secret");

const stripeActive: SubscriptionColumns = {
  user_id: A,
  status: "active",
  trial_ends_at: "2026-08-01T00:00:00Z",
  plan_source: "stripe",
  current_period_end: "2026-11-26T00:00:00Z",
  cancel_at_period_end: true,
  referral_code: "PHIL-TEST",
  referral_uses: 2,
  referral_last_use_at: "2026-10-01T00:00:00Z",
  referral_credits_earned: 1,
  referral_last_credit_at: "2026-10-02T00:00:00Z",
};
const appleActive: SubscriptionColumns = {
  user_id: B,
  status: "active",
  trial_ends_at: null,
  plan_source: "apple",
};
const lapsed: SubscriptionColumns = {
  user_id: A,
  status: "trialing",
  trial_ends_at: "2026-10-01T00:00:00Z",
  plan_source: null,
};

ok(entitlementOf(stripeActive, A, now).entitled === true, "stripe active is entitled");
ok(entitlementOf(appleActive, B, now).entitled === true, "apple active is entitled");
ok(entitlementOf(lapsed, A, now).entitled === false, "lapsed trial is not entitled");
ok(entitlementOf(null, A, now).entitled === false, "missing row is not entitled");
ok(entitlementOf(null, A, now).present === false, "missing row is present=false");
ok(entitlementOf(stripeActive, A, now).plan === "active", "plan comes from status");

const url = subscriptionQueryUrl("https://example.supabase.co", A);
ok(url.includes("user_id=eq." + A), "query URL keys by the session user id");
ok(url.includes("/rest/v1/subscriptions"), "query URL hits Supabase subscriptions");
ok(!url.includes("email"), "query URL has no email");
ok(!url.includes(B), "query URL does not include another user id");
ok(url.includes("select=user_id"), "select is physical columns");
ok(!url.includes("entitled") && !url.includes("plan,"), "select omits computed aliases");
ok(url.includes("current_period_end") && url.includes("cancel_at_period_end"), "select includes period / cancel display fields");
ok(url.includes("referral_code") && url.includes("referral_uses") && url.includes("referral_credits_earned"), "select includes referral display fields");
ok(
  !url.includes("stripe_customer") &&
    !url.includes("stripe_subscription") &&
    !url.includes("price_id") &&
    !url.includes("stripe_promotion") &&
    !url.includes("apple_original") &&
    !url.includes("apple_product"),
  "select omits Stripe / Apple identifiers",
);

const calls: string[] = [];
const fakeFetch: typeof fetch = async (input) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push(href);
  return new Response(JSON.stringify([stripeActive]), { status: 200, headers: { "content-type": "application/json" } });
};

const fetched = await fetchSubscriptionByUserId(
  { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test" },
  A,
  fakeFetch,
);
ok(fetched?.user_id === A, "fetch returns the row for the requested id");
ok(calls.length === 1 && calls[0]?.includes(A) && !calls[0]?.includes(B), "fetch requested only A");

const wrongUserFetch: typeof fetch = async () =>
  new Response(JSON.stringify([{ ...stripeActive, user_id: B }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const rejected = await fetchSubscriptionByUserId(
  { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test" },
  A,
  wrongUserFetch,
);
ok(rejected === null, "a row for a different user_id is dropped (no cross-user leak)");

for (const status of [404, 406] as const) {
  try {
    await fetchSubscriptionByUserId(
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test" },
      A,
      async () => new Response("nope", { status }),
    );
    ok(false, `fetch ${status}: must fail closed`);
  } catch (err) {
    ok(err instanceof EntitlementUnavailableError, `fetch ${status}: fail closed, not empty row`);
  }
}
const emptyOk = await fetchSubscriptionByUserId(
  { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test" },
  A,
  async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
);
ok(emptyOk === null, "fetch 200 + [] is the documented empty result");

const body = entitlementResponseBody(entitlementOf(stripeActive, A, now));
ok(body.entitled === true && body.plan === "active", "response body carries the tier");
ok(body.current_period_end === "2026-11-26T00:00:00Z", "response body carries current_period_end");
ok(body.cancel_at_period_end === true, "response body carries cancel_at_period_end");
ok(body.referral_code === "PHIL-TEST" && body.referral_uses === 2 && body.referral_credits_earned === 1, "response body carries referral display fields");
ok(!("stripe_customer_id" in body) && !("stripe_subscription_id" in body) && !("price_id" in body), "response omits Stripe identifiers");
ok(!("stripe_promotion_code_id" in body), "response omits the Stripe promotion id");
ok(!("apple_original_transaction_id" in body), "response omits Apple identifiers");

const authOk = compareAuthIds([A, B], [A, B]);
ok(authOk.identical === 2 && authOk.remaps === 0, "1:1 auth copy: 2/2 identical, 0 remaps");
const remapped = compareAuthIds([A, B], ["33333333-3333-3333-3333-333333333333", B]);
ok(remapped.remaps === 2 && remapped.identical === 1, "a remapped id is not 1:1");

const parity = compareEntitlementParity({
  sourceUserIds: [A, B],
  targetUserIds: [A, B],
  subscriptions: [stripeActive, appleActive],
  now,
});
ok(parity.ok && parity.entitlementMismatches === 0, "parity: same ids keep the same tier");
ok(parity.identical === 2 && parity.subscriptions === 2, "parity counts: 2 users, 2 subscriptions");

const broken = compareEntitlementParity({
  sourceUserIds: [A, B],
  targetUserIds: [A, B],
  subscriptions: [stripeActive],
  now,
  readAfter: () => entitlementOf(lapsed, A, now),
});
ok(!broken.ok && broken.entitlementMismatches === 1, "parity fails when the Worker check disagrees");

const orphan = compareEntitlementParity({
  sourceUserIds: [A],
  targetUserIds: [A],
  subscriptions: [appleActive],
  now,
});
ok(!orphan.ok && orphan.orphanSubscriptions === 1, "parity fails when a subscription user is missing from the copy");

const restoreFetch = installSubscriptionFetcherForTests(async (_env, userId) =>
  userId === A ? stripeActive : null,
);
const after = await readEntitlement({}, A, now);
ok(after.userId === A && after.entitled === true, "readEntitlement uses the given user id");
const other = await readEntitlement({}, B, now);
ok(other.userId === B && other.present === false && other.entitled === false, "readEntitlement for an unknown id is not entitled");
restoreFetch();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("entitlement check: ok");
