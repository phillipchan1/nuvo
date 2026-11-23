// Worker entitlement check: lookup is always the preserved user_id.
// Run: node --experimental-strip-types worker/src/entitlement.check.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  EntitlementUnavailableError,
  entitlementOf,
  entitlementResponseBody,
  fetchSubscriptionFromNeon,
  installSubscriptionFetcherForTests,
  readEntitlement,
  type SubscriptionColumns,
} from "./entitlement.ts";
import { compareAuthIds, compareEntitlementParity } from "./entitlementParity.ts";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "entitlement.ts"), "utf8");
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
const envSrc = readFileSync(join(here, "env.ts"), "utf8");
const now = new Date("2026-10-26T19:00:00Z");
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

ok(!/from ["']stripe["']/.test(src), "entitlement.ts does not import the Stripe SDK");
ok(!/STRIPE_SECRET|stripe\.subscriptions|StoreKit/.test(src), "entitlement.ts does not call Stripe or StoreKit");
ok(!/apple-iap|apple-webhook|stripe-webhook|stripe-checkout|stripe-portal/.test(src), "entitlement.ts does not import billing writers");
ok(!/from\(["']subscriptions["']\)/.test(src), "entitlement.ts does not use the supabase-js writer client");
ok(/WHERE user_id =/.test(src), "lookup filter is user_id");
ok(!/email=/.test(src), "lookup never filters by email");
ok(/readEntitlement/.test(indexSrc), "index.ts calls readEntitlement");
ok(/\/api\/entitlement/.test(indexSrc), "index.ts serves GET /api/entitlement");
ok(!/STRIPE_SECRET/.test(indexSrc), "Worker router does not read a Stripe secret");
ok(!/SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/.test(envSrc), "Env no longer names Supabase billing secrets");
ok(/Boolean\(sql\) && cutoverFlipped\(env\.CUTOVER_FLIPPED\) && !fetcherOverridden/.test(src), "flag-on path still requires sql + CUTOVER_FLIPPED");
ok(/fetchSubscriptionFromNeon\(sql!, userId\)/.test(src), "flag-on path still reads Neon");
ok(/entitlement store unavailable/.test(src), "no store fails closed");

const supabaseEnvNeedle = ["env", "SUPABASE_"].join(".");
function workerSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...workerSrcFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".check.ts")) out.push(full);
  }
  return out;
}
for (const file of workerSrcFiles(here)) {
  const body = readFileSync(file, "utf8");
  ok(!body.includes(supabaseEnvNeedle), `${file.slice(here.length + 1)} has no ${supabaseEnvNeedle}`);
}

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

const neonSelect = src.slice(src.indexOf("SELECT user_id::text"), src.indexOf("FROM subscriptions"));
ok(neonSelect.includes("user_id") && neonSelect.includes("current_period_end") && neonSelect.includes("cancel_at_period_end"), "Neon select includes period / cancel display fields");
ok(neonSelect.includes("referral_code") && neonSelect.includes("referral_uses") && neonSelect.includes("referral_credits_earned"), "Neon select includes referral display fields");
ok(!/entitled/.test(neonSelect) && !/, plan,/.test(neonSelect), "Neon select omits computed aliases");
ok(
  !neonSelect.includes("stripe_customer") &&
    !neonSelect.includes("stripe_subscription") &&
    !neonSelect.includes("price_id") &&
    !neonSelect.includes("stripe_promotion") &&
    !neonSelect.includes("apple_original") &&
    !neonSelect.includes("apple_product"),
  "Neon select omits Stripe / Apple identifiers",
);

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);
await db.query(
  `INSERT INTO subscriptions (
    user_id, status, trial_ends_at, plan_source, current_period_end, cancel_at_period_end,
    referral_code, referral_uses, referral_last_use_at, referral_credits_earned, referral_last_credit_at
  ) VALUES (
    $1, 'active', '2026-08-01T00:00:00Z', 'stripe', '2026-11-26T00:00:00Z', true,
    'PHIL-TEST', 2, '2026-10-01T00:00:00Z', 1, '2026-10-02T00:00:00Z'
  )`,
  [A],
);

const fetched = await fetchSubscriptionFromNeon(sql, A);
ok(fetched?.user_id === A, "Neon fetch returns the row for the requested id");
ok(fetched?.plan_source === "stripe" && fetched?.cancel_at_period_end === true, "Neon fetch maps physical columns");
ok(fetched?.referral_code === "PHIL-TEST" && fetched?.referral_uses === 2, "Neon fetch maps referral display fields");

const missing = await fetchSubscriptionFromNeon(sql, B);
ok(missing === null, "Neon fetch for an unknown id is empty");

const flipped = { CUTOVER_FLIPPED: "1" };
const fromRead = await readEntitlement(flipped, A, now, sql);
ok(fromRead.userId === A && fromRead.entitled === true && fromRead.present === true, "flag-on readEntitlement reads Neon");
ok(fromRead.referralCode === "PHIL-TEST", "flag-on readEntitlement carries referral fields");

const unknown = await readEntitlement(flipped, B, now, sql);
ok(unknown.userId === B && unknown.present === false && unknown.entitled === false, "flag-on unknown id is not entitled");

try {
  await readEntitlement(flipped, A, now);
  ok(false, "flag-on without sql must fail closed");
} catch (err) {
  ok(err instanceof EntitlementUnavailableError, "flag-on without sql is EntitlementUnavailableError");
}

try {
  await readEntitlement({ CUTOVER_FLIPPED: "" }, A, now, sql);
  ok(false, "flag-off must not fall back");
} catch (err) {
  ok(err instanceof EntitlementUnavailableError, "flag-off without a test fetcher fails closed");
}

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
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("entitlement check: ok");
