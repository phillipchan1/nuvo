// Billing on the Worker: gate, signatures, replay/dedupe, entitlement result.
// No live keys: PGlite for Neon, a mocked Stripe, a generated Apple-style CA.
// Run: node --experimental-strip-types worker/src/billing.check.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import app from "./index.ts";
import { installBillingForTests, BILLING_ROUTE_NAMES } from "./billing/routes.ts";
import { stripeSignatureFor, verifyStripeEvent, encodeStripeForm } from "./billing/stripeApi.ts";
import { verifyAppleJws, APPLE_ROOT_CA_G3_SHA256 } from "./billing/appleJws.ts";
import { wipeOwnedAccount } from "./store.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));

// ── static guards ────────────────────────────────────────────────────────────
const routesSrc = readFileSync(join(here, "billing/routes.ts"), "utf8");
const handlersSrc = readFileSync(join(here, "billing/handlers.ts"), "utf8");
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
ok(/registerBillingRoutes\(app\)/.test(indexSrc), "index.ts registers billing routes");
ok(
  indexSrc.indexOf("registerBillingRoutes(app)") < indexSrc.indexOf('app.all("/functions/v1/:name"'),
  "billing routes register before the stay_on_supabase catch-all",
);
ok((routesSrc.match(/cutoverFlipped\(c\.env\?\.CUTOVER_FLIPPED\)/g) ?? []).length >= 2, "user + webhook routes both check the flip");
ok(!/STRIPE_SECRET/.test(indexSrc), "router itself still reads no Stripe secret");
ok(/idempotencyKey: `nuvo-referral-reward-\$\{friend\.user_id\}`/.test(handlersSrc), "referral credit carries a per-friend Stripe idempotency key");
ok(!/decodeJwsPayload/.test(handlersSrc), "apple webhook never trusts an unverified JWS decode");

// ── form encoding (what Stripe receives) ─────────────────────────────────────
const form = new URLSearchParams(
  encodeStripeForm({ line_items: [{ price: "p", quantity: 1 }], metadata: { app: "nuvo" }, expand: ["a.b"], x: undefined }),
);
ok(form.get("line_items[0][price]") === "p" && form.get("line_items[0][quantity]") === "1", "form: array of objects");
ok(form.get("metadata[app]") === "nuvo" && form.get("expand[]") === "a.b" && !form.has("x"), "form: nested + scalar arrays");

// ── Stripe signature, pure ───────────────────────────────────────────────────
const WHSEC = "whsec_test_billing_check";
const NOW = 1_800_000_000;
{
  const body = JSON.stringify({ id: "evt_pure", type: "ping" });
  const sig = await stripeSignatureFor(body, WHSEC, NOW);
  const good = await verifyStripeEvent(body, `t=${NOW},v1=${sig}`, WHSEC, NOW).then(() => true, () => false);
  ok(good, "stripe sig: valid header verifies");
  const tampered = await verifyStripeEvent(body.replace("ping", "pong"), `t=${NOW},v1=${sig}`, WHSEC, NOW).then(() => true, () => false);
  ok(!tampered, "stripe sig: tampered body refused");
  const stale = await verifyStripeEvent(body, `t=${NOW},v1=${sig}`, WHSEC, NOW + 301).then(() => true, () => false);
  ok(!stale, "stripe sig: replayed body outside 300s tolerance refused");
  const wrong = await verifyStripeEvent(body, `t=${NOW},v1=${sig}`, "whsec_other", NOW).then(() => true, () => false);
  ok(!wrong, "stripe sig: wrong endpoint secret refused");
  const unset = await verifyStripeEvent(body, `t=${NOW},v1=${sig}`, "", NOW).then(() => true, () => false);
  ok(!unset, "stripe sig: unset secret fails closed");
  const multi = await verifyStripeEvent(body, `t=${NOW},v1=deadbeef,v1=${sig}`, WHSEC, NOW).then(() => true, () => false);
  ok(multi, "stripe sig: any matching v1 (secret rotation) verifies");
}

// ── Apple test CA (DER by hand; same shape as Apple's x5c) ───────────────────
function lenBytes(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}
function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const head = [tag, ...lenBytes(total)];
  const out = new Uint8Array(head.length + total);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const u8 = (...b: number[]) => new Uint8Array(b);
const seq = (...p: Uint8Array[]) => tlv(0x30, ...p);
const OID_SHA256 = u8(0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02);
const OID_SHA384 = u8(0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03);
const OID_LEAF = u8(0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x0b, 0x01);
const OID_INTER = u8(0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x02, 0x01);
function name(cn: string): Uint8Array {
  return seq(tlv(0x31, seq(u8(0x06, 0x03, 0x55, 0x04, 0x03), tlv(0x0c, new TextEncoder().encode(cn)))));
}
function utc(d: Date): Uint8Array {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(s));
}
function derInt(raw: Uint8Array): Uint8Array {
  let v = raw;
  while (v.length > 1 && v[0] === 0 && !(v[1]! & 0x80)) v = v.slice(1);
  if (v[0]! & 0x80) v = new Uint8Array([0, ...v]);
  return tlv(0x02, v);
}
function rawToDerSig(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return seq(derInt(raw.slice(0, half)), derInt(raw.slice(half)));
}
type Key = { pair: CryptoKeyPair; spki: Uint8Array; curve: "P-256" | "P-384" };
async function newKey(curve: "P-256" | "P-384"): Promise<Key> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { pair, spki, curve };
}
let serial = 1;
async function cert(subject: string, key: Key, issuer: string, issuerKey: Key, marker: Uint8Array | null, nb: Date, na: Date) {
  const sigOid = issuerKey.curve === "P-384" ? OID_SHA384 : OID_SHA256;
  const hash = issuerKey.curve === "P-384" ? "SHA-384" : "SHA-256";
  const ext = marker ? [tlv(0xa3, seq(seq(marker, tlv(0x04, u8(0x05, 0x00)))))] : [];
  const tbs = seq(
    tlv(0xa0, u8(0x02, 0x01, 0x02)),
    u8(0x02, 0x01, serial++),
    seq(sigOid),
    name(issuer),
    seq(utc(nb), utc(na)),
    name(subject),
    key.spki,
    ...ext,
  );
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash }, issuerKey.pair.privateKey, tbs));
  return seq(tbs, seq(sigOid), tlv(0x03, u8(0), rawToDerSig(raw)));
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256Hex(b: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)), (x) => x.toString(16).padStart(2, "0")).join("");
}

const past = new Date("2020-01-01T00:00:00Z");
const future = new Date("2040-01-01T00:00:00Z");
const rootKey = await newKey("P-384");
const interKey = await newKey("P-384");
const leafKey = await newKey("P-256");
const rootDer = await cert("Test Root CA - G3", rootKey, "Test Root CA - G3", rootKey, null, past, future);
const interDer = await cert("Test WWDR G6", interKey, "Test Root CA - G3", rootKey, OID_INTER, past, future);
const leafDer = await cert("Test Prod ECC Mac App Store", leafKey, "Test WWDR G6", interKey, OID_LEAF, past, future);
const rootFp = await sha256Hex(rootDer);
const x5c = [b64(leafDer), b64(interDer), b64(rootDer)];

async function jws(payload: Record<string, unknown>, opts: { key?: Key; chain?: string[] } = {}) {
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", x5c: opts.chain ?? x5c })));
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, (opts.key ?? leafKey).pair.privateKey, new TextEncoder().encode(`${h}.${p}`)),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

{
  const pins = { rootFingerprints: [rootFp] };
  const good = await jws({ hello: "apple", signedDate: Date.parse("2026-11-06T00:00:00Z") });
  ok((await verifyAppleJws(good, pins).catch(() => null))?.hello === "apple", "apple jws: valid chain + signature verifies");
  ok((await verifyAppleJws(good).catch(() => null)) === null, "apple jws: generated root is refused under the real Apple pin");
  ok(/^[0-9a-f]{64}$/.test(APPLE_ROOT_CA_G3_SHA256), "apple jws: production pin is a SHA-256");
  const [h, p, s] = good.split(".");
  const forgedPayload = b64url(new TextEncoder().encode(JSON.stringify({ hello: "mallory" })));
  ok((await verifyAppleJws(`${h}.${forgedPayload}.${s}`, pins).catch(() => null)) === null, "apple jws: swapped payload refused");
  const rogue = await newKey("P-256");
  ok((await verifyAppleJws(await jws({ a: 1 }, { key: rogue }), pins).catch(() => null)) === null, "apple jws: signature by a key not in x5c refused");
  const rogueLeaf = await cert("Rogue", rogue, "Rogue Issuer", rogue, OID_LEAF, past, future);
  ok(
    (await verifyAppleJws(await jws({ a: 1 }, { key: rogue, chain: [b64(rogueLeaf), x5c[1]!, x5c[2]!] }), pins).catch(() => null)) === null,
    "apple jws: leaf not issued by the intermediate refused",
  );
  const noMarker = await cert("No marker", leafKey, "Test WWDR G6", interKey, null, past, future);
  ok(
    (await verifyAppleJws(await jws({ a: 1 }, { chain: [b64(noMarker), x5c[1]!, x5c[2]!] }), pins).catch(() => null)) === null,
    "apple jws: leaf without Apple's signing OID refused",
  );
  const expired = await jws({ a: 1, signedDate: Date.parse("2045-01-01T00:00:00Z") });
  ok((await verifyAppleJws(expired, pins).catch(() => null)) === null, "apple jws: cert outside validity at signedDate refused");
  ok(_unused(p), "");
}
function _unused(_: unknown) {
  return true;
}

// ── Neon + app wiring ────────────────────────────────────────────────────────
const db = new PGlite();
await applyIsolationSchema(db);
const rawSql = makePgliteSql(db);

// Race barrier: when armed, every delivery's "is this friend already
// rewarded?" read waits until N of them have read — the worst interleaving,
// forced, so only the conditional claim can stop a double credit.
let barrier: { want: number; seen: number; release: () => void; gate: Promise<void> } | null = null;
function armBarrier(want: number) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  barrier = { want, seen: 0, release, gate };
}
const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const rows = await rawSql(strings, ...values);
  const text = strings.join("?");
  if (barrier && text.includes("FROM subscriptions WHERE stripe_customer_id =") && text.includes("referral_reward_granted_at")) {
    const b = barrier;
    b.seen += 1;
    if (b.seen >= b.want) b.release();
    await b.gate;
  }
  return rows;
}) as unknown as typeof rawSql;
Object.assign(sql, { json: rawSql.json, begin: rawSql.begin, unsafe: rawSql.unsafe });

const A = "aaaa0000-0000-4000-8000-00000000000a"; // Stripe buyer / referred friend
const R = "bbbb0000-0000-4000-8000-00000000000b"; // referrer
const P = "cccc0000-0000-4000-8000-00000000000c"; // Apple buyer
for (const [id, email, nm] of [[A, "a@billing.test", "Ada Lovelace"], [R, "r@billing.test", "Rex"], [P, "p@billing.test", "Pat"]]) {
  await db.query(`INSERT INTO users (id, email, auth_id) VALUES ($1, $2, $1)`, [id, email]);
  await db.query(`INSERT INTO "user" (id, email, name, "emailVerified") VALUES ($1, $2, $3, true)`, [id, email, nm]);
  await db.query(`INSERT INTO subscriptions (user_id, status, trial_ends_at) VALUES ($1, 'trialing', '2099-01-01T00:00:00Z')`, [id]);
}
await db.query(`UPDATE subscriptions SET referral_code = 'REX-AAAA', stripe_customer_id = 'cus_R' WHERE user_id = $1`, [R]);

let ioOpened = 0;
const restoreIo = installRequestIoForTests(() => {
  ioOpened += 1;
  return {
    sql,
    auth: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get("authorization")?.replace(/^Bearer\s+/i, "");
          if (!id) return null;
          return { user: { id, email: `${id.slice(0, 4)}@billing.test`, emailVerified: true } };
        },
      },
    } as never,
    close: async () => {},
  };
});

type Call = { url: string; method: string; body: string; headers: Record<string, string> };
const calls: Call[] = [];
let failInvoiceRetrieve = false;
const stripeFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  calls.push({ url: input, method: init.method ?? "GET", body: String(init.body ?? ""), headers });
  const u = new URL(input);
  const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (u.hostname === "api.resend.com") return j({ id: "email" });
  if (u.hostname !== "api.stripe.com") return j({}, 404);
  const path = u.pathname;
  if (path === "/v1/checkout/sessions" && init.method === "POST") return j({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" });
  if (path === "/v1/billing_portal/sessions") return j({ url: "https://billing.stripe.test/p" });
  if (path === "/v1/promotion_codes" && init.method === "POST") {
    const code = new URLSearchParams(String(init.body)).get("code");
    return j({ id: "promo_new", code });
  }
  if (path === "/v1/promotion_codes") {
    if (u.searchParams.get("code") === "REX-AAAA") {
      return j({ data: [{ id: "promo_R", code: "REX-AAAA", metadata: { app: "nuvo", kind: "referral", referrer_user_id: R } }] });
    }
    return j({ data: [] });
  }
  if (path.startsWith("/v1/checkout/sessions/")) {
    return j({
      id: "cs_paid",
      total_details: { breakdown: { discounts: [{ discount: { promotion_code: { id: "promo_R", code: "REX-AAAA", metadata: { app: "nuvo", kind: "referral", referrer_user_id: R } } } }] } },
    });
  }
  if (path.startsWith("/v1/invoices/")) {
    if (failInvoiceRetrieve) return j({ error: { message: "stripe is down" } }, 500);
    return j(paidInvoice);
  }
  if (path === "/v1/customers/cus_R") return j({ id: "cus_R", balance: 0 });
  if (path === "/v1/customers/cus_R/balance_transactions") return j({ id: "cbtxn_1" });
  return j({ error: { message: `unmocked ${path}` } }, 404);
};

const paidInvoice = {
  id: "in_first",
  object: "invoice",
  status: "paid",
  billing_reason: "subscription_create",
  customer: "cus_A",
  subscription: "sub_A",
  lines: { data: [{ price: { id: "price_monthly" } }] },
};

const restoreBilling = installBillingForTests({ fetch: stripeFetch, appleJws: { rootFingerprints: [rootFp] }, nowSeconds: NOW });

const baseEnv = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  STRIPE_SECRET_KEY: "sk_test_billing_check",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_PRICE_MONTHLY: "price_monthly",
  STRIPE_PRICE_ANNUAL: "price_annual",
  STRIPE_REFERRAL_COUPON: "coup_test",
  APP_URL: "https://app.nuvo.day",
  APPLE_BUNDLE_ID: "day.nuvo.app",
  NUVO_IAP_MONTHLY: "NUVO_IAP_MONTHLY",
  NUVO_IAP_ANNUAL: "NUVO_IAP_ANNUAL",
};
const flipped = { ...baseEnv, CUTOVER_FLIPPED: "1" };

const req = (path: string, init: RequestInit, env: Record<string, string>) =>
  app.request(`http://localhost:8787${path}`, init, env);
const asUser = (id: string, body: unknown = {}): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${id}`, "Content-Type": "application/json", Origin: "https://app.nuvo.day" },
  body: JSON.stringify(body),
});
async function stripeEvent(event: Record<string, unknown>, opts: { secret?: string; t?: number } = {}): Promise<RequestInit> {
  const body = JSON.stringify(event);
  const t = opts.t ?? NOW;
  const v1 = await stripeSignatureFor(body, opts.secret ?? WHSEC, t);
  return { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${v1}`, "Content-Type": "application/json" }, body };
}
const row = async (id: string) => (await db.query(`SELECT * FROM subscriptions WHERE user_id = $1`, [id])).rows[0] as Record<string, unknown>;

// ── 1. Inert until the flip ──────────────────────────────────────────────────
ioOpened = 0;
for (const prefix of ["/api", "/functions/v1"]) {
  for (const name of BILLING_ROUTE_NAMES) {
    if (name === "iap-catalog") continue;
    const init = name.endsWith("webhook") ? await stripeEvent({ id: "evt_pre", type: "customer.subscription.updated" }) : asUser(A, { plan: "monthly" });
    const res = await req(`${prefix}/${name}`, init, baseEnv);
    const body = (await res.json().catch(() => ({}))) as { reason?: string; stay_on_supabase?: boolean };
    ok(res.status === 503, `pre-flip ${prefix}/${name}: 503, not 200 (got ${res.status})`);
    ok(body.reason === "cutover_not_flipped" && body.stay_on_supabase === true, `pre-flip ${prefix}/${name}: skip body`);
    ok(res.headers.get("retry-after") === "300", `pre-flip ${prefix}/${name}: Retry-After so the provider retries`);
  }
}
ok(ioOpened === 0, `pre-flip: no DB opened by any billing route (opened ${ioOpened})`);
ok((await db.query(`SELECT count(*)::int AS n FROM stripe_webhook_events`)).rows[0]!.n === 0 as never, "pre-flip: no ledger rows written");
ok(calls.length === 0, "pre-flip: Stripe never called");
for (const v of ["0", "false", "typo", ""]) {
  const res = await req("/api/stripe-webhook", await stripeEvent({ id: "evt_v", type: "x" }), { ...baseEnv, CUTOVER_FLIPPED: v });
  ok(res.status === 503, `CUTOVER_FLIPPED=${JSON.stringify(v)} stays inert`);
}
const catalog = await req("/functions/v1/iap-catalog", { method: "POST" }, baseEnv);
const catBody = (await catalog.json()) as { monthly?: string; annual?: string };
ok(catalog.status === 200 && catBody.monthly === "NUVO_IAP_MONTHLY" && catBody.annual === "NUVO_IAP_ANNUAL", "iap-catalog: ids only, served pre-flip");

// ── 2. Stripe webhook: signature failures write nothing ──────────────────────
const subEvent = {
  id: "evt_sub_1",
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_A",
      object: "subscription",
      status: "active",
      customer: "cus_A",
      cancel_at_period_end: false,
      metadata: { app: "nuvo", user_id: A },
      items: { data: [{ price: { id: "price_monthly" }, current_period_end: 1_900_000_000 }] },
    },
  },
};
{
  const noSig = await req("/api/stripe-webhook", { method: "POST", body: JSON.stringify(subEvent) }, flipped);
  ok(noSig.status === 400, `stripe webhook: missing signature 400 (got ${noSig.status})`);
  const badSecret = await req("/api/stripe-webhook", await stripeEvent(subEvent, { secret: "whsec_attacker" }), flipped);
  ok(badSecret.status === 400, "stripe webhook: wrong secret 400");
  const stale = await req("/api/stripe-webhook", await stripeEvent(subEvent, { t: NOW - 3600 }), flipped);
  ok(stale.status === 400, "stripe webhook: hour-old signed replay 400");
  const r = await row(A);
  ok(r.status === "trialing" && r.stripe_subscription_id === null, "stripe webhook: rejected deliveries wrote nothing");
  ok((await db.query(`SELECT count(*)::int AS n FROM stripe_webhook_events`)).rows[0]!.n === 0 as never, "stripe webhook: rejected deliveries claimed no ledger row");
}

// ── 3. Stripe webhook: entitlement result + replay dedupe ────────────────────
{
  const res = await req("/api/stripe-webhook", await stripeEvent(subEvent), flipped);
  ok(res.status === 200, `stripe webhook: subscription.updated 200 (got ${res.status})`);
  const r = await row(A);
  ok(r.status === "active" && r.plan_source === "stripe", "stripe webhook: row active via stripe");
  ok(r.stripe_subscription_id === "sub_A" && r.stripe_customer_id === "cus_A" && r.price_id === "price_monthly", "stripe webhook: rail ids written");

  const ent = await req("/api/entitlement", { headers: { Authorization: `Bearer ${A}` } }, flipped);
  const entBody = (await ent.json()) as { entitled?: boolean; plan?: string; plan_source?: string; stripe_customer_id?: unknown };
  ok(ent.status === 200 && entBody.entitled === true && entBody.plan === "active" && entBody.plan_source === "stripe", "entitlement (Neon, post-flip): A is entitled via stripe");
  ok(entBody.stripe_customer_id === undefined, "entitlement: no Stripe ids leak");

  // Prove the replay is a no-op: move the row by hand, then redeliver the same event.
  await db.query(`UPDATE subscriptions SET status = 'past_due' WHERE user_id = $1`, [A]);
  const replay = await req("/api/stripe-webhook", await stripeEvent(subEvent), flipped);
  const replayBody = (await replay.json()) as { duplicate?: boolean };
  ok(replay.status === 200 && replayBody.duplicate === true, "stripe webhook: same event id → duplicate ack");
  ok((await row(A)).status === "past_due", "stripe webhook: replay did not write again");
  await db.query(`UPDATE subscriptions SET status = 'active' WHERE user_id = $1`, [A]);

  const deleted = { ...subEvent, id: "evt_sub_del", type: "customer.subscription.deleted" };
  await req("/api/stripe-webhook", await stripeEvent(deleted), flipped);
  ok((await row(A)).status === "cancelled", "stripe webhook: subscription.deleted cancels");
  const entAfter = (await (await req("/api/entitlement", { headers: { Authorization: `Bearer ${A}` } }, flipped)).json()) as { entitled?: boolean };
  ok(entAfter.entitled === false, "entitlement: cancelled is not entitled");
  await req("/api/stripe-webhook", await stripeEvent({ ...subEvent, id: "evt_sub_2" }), flipped);

  const foreign = {
    id: "evt_foreign",
    type: "customer.subscription.updated",
    data: { object: { ...subEvent.data.object, id: "sub_X", customer: "cus_A", metadata: { app: "dayspring" }, items: { data: [{ price: { id: "price_other" } }] }, status: "canceled" } },
  };
  await req("/api/stripe-webhook", await stripeEvent(foreign), flipped);
  ok((await row(A)).status === "active", "stripe webhook: another app's subscription on the shared account is ignored");
}

// ── 4. Handler failure releases the ledger so Stripe's retry runs it ─────────
const checkoutDone = {
  id: "evt_cs_done",
  type: "checkout.session.completed",
  data: { object: { id: "cs_paid", object: "checkout.session", client_reference_id: A, customer: "cus_A", invoice: "in_first", metadata: { app: "nuvo", user_id: A } } },
};
{
  failInvoiceRetrieve = true;
  const res = await req("/api/stripe-webhook", await stripeEvent(checkoutDone), flipped);
  ok(res.status === 500, `stripe webhook: Stripe outage mid-handler → 500 (got ${res.status})`);
  const ledger = await db.query(`SELECT 1 FROM stripe_webhook_events WHERE event_id = 'evt_cs_done'`);
  ok(ledger.rows.length === 0, "stripe webhook: failed event released from the ledger");
  failInvoiceRetrieve = false;
}

// ── 5. Referral: one credit, however many deliveries race ────────────────────
{
  calls.length = 0;
  const retry = await req("/api/stripe-webhook", await stripeEvent(checkoutDone), flipped);
  ok(retry.status === 200, `referral: Stripe's retry of checkout.session.completed 200 (got ${retry.status})`);
  const friend = await row(A);
  ok(friend.referred_by === R && friend.referral_code_used === "REX-AAAA", "referral: friend attributed to the referrer");
  ok(friend.referral_reward_granted_at !== null, "referral: reward marked granted");
  const credits = calls.filter((c) => c.url.endsWith("/v1/customers/cus_R/balance_transactions"));
  ok(credits.length === 1, `referral: exactly one balance credit (got ${credits.length})`);
  ok(credits[0]?.headers["idempotency-key"] === `nuvo-referral-reward-${A}`, "referral: credit carries the per-friend idempotency key");
  const params = new URLSearchParams(credits[0]?.body ?? "");
  ok(params.get("amount") === "-2900" && params.get("currency") === "usd", "referral: one month ($29) credit");
  ok(calls.every((c) => c.headers["stripe-version"] === "2026-05-27.dahlia"), "stripe: same API version as the Supabase SDK");

  // invoice.paid for the same first invoice, as a separate event — must not credit again.
  const invoicePaid = { id: "evt_inv_paid", type: "invoice.paid", data: { object: paidInvoice } };
  await req("/api/stripe-webhook", await stripeEvent(invoicePaid), flipped);
  const again = calls.filter((c) => c.url.endsWith("/balance_transactions"));
  ok(again.length === 1, `referral: invoice.paid after checkout does not double-credit (got ${again.length})`);
  const referrer = await row(R);
  ok(referrer.referral_uses === 1 && referrer.referral_credits_earned === 1, "referral: referrer counts bumped once");
}

// ── 5b. Two deliveries for the same first invoice, concurrently ────────────
{
  const F = "eeee0000-0000-4000-8000-00000000000e";
  await db.query(`INSERT INTO users (id, email, auth_id) VALUES ($1, 'f@billing.test', $1)`, [F]);
  await db.query(`INSERT INTO "user" (id, email, name, "emailVerified") VALUES ($1, 'f@billing.test', 'Fay', true)`, [F]);
  await db.query(
    `INSERT INTO subscriptions (user_id, status, trial_ends_at, stripe_customer_id, referred_by, referral_code_used)
     VALUES ($1, 'active', '2099-01-01T00:00:00Z', 'cus_F', $2, 'REX-AAAA')`,
    [F, R],
  );
  calls.length = 0;
  const inv = { ...paidInvoice, id: "in_F", customer: "cus_F", subscription: "sub_F" };
  // Sign all three first, so the deliveries really are in flight together.
  const inits = await Promise.all(
    ["evt_race_1", "evt_race_2", "evt_race_3"].map((id) => stripeEvent({ id, type: "invoice.paid", data: { object: inv } })),
  );
  armBarrier(3);
  const [r1, r2, r3] = await Promise.all(inits.map((init) => req("/api/stripe-webhook", init, flipped)));
  barrier = null;
  ok([r1, r2, r3].every((r) => r.status === 200), "referral race: all deliveries acked");
  const credits = calls.filter((c) => c.url.endsWith("/balance_transactions"));
  ok(credits.length === 1, `referral race: concurrent invoice.paid credits once (got ${credits.length})`);
  ok((await row(R)).referral_credits_earned === 2, "referral race: referrer credited once more, not three times");
}

// ── 6. User routes: checkout / portal / referral-code / apple-iap ────────────
{
  calls.length = 0;
  const bad = await req("/functions/v1/stripe-checkout", asUser(P, { plan: "weekly" }), flipped);
  ok(bad.status === 400, "checkout: plan must be monthly|annual");
  const unauth = await req("/functions/v1/stripe-checkout", { method: "POST", body: "{}" }, flipped);
  ok(unauth.status === 401, "checkout: no session 401");
  const res = await req("/functions/v1/stripe-checkout", asUser(P, { plan: "annual", origin: "https://evil.test", code: "rex-aaaa" }), flipped);
  const body = (await res.json()) as { url?: string };
  ok(res.status === 200 && body.url === "https://checkout.stripe.test/cs_new", "checkout: returns the session url");
  const create = calls.find((c) => c.url.endsWith("/v1/checkout/sessions") && c.method === "POST");
  const p = new URLSearchParams(create?.body ?? "");
  ok(p.get("client_reference_id") === P && p.get("metadata[app]") === "nuvo" && p.get("subscription_data[metadata][user_id]") === P, "checkout: owner + app tags from the session, never the body");
  ok(p.get("line_items[0][price]") === "price_annual" && p.get("customer_email") === "cccc@billing.test", "checkout: annual price + session email");
  ok(p.get("success_url") === "https://app.nuvo.day/?checkout=success", "checkout: foreign origin falls back to APP_URL");
  ok(p.get("discounts[0][promotion_code]") === "promo_R" && p.get("allow_promotion_codes") === "false", "checkout: friend code pre-applied");
  ok(create?.headers.authorization === "Bearer sk_test_billing_check", "checkout: secret key only in the Stripe header");

  const portalNone = await req("/functions/v1/stripe-portal", asUser(P), flipped);
  ok(portalNone.status === 404, "portal: no customer yet → 404");
  const portal = await req("/api/stripe-portal", asUser(A, { origin: "http://localhost:5717" }), flipped);
  ok(portal.status === 200, "portal: customer → 200");
  const portalCall = calls.find((c) => c.url.endsWith("/v1/billing_portal/sessions"));
  ok(new URLSearchParams(portalCall?.body ?? "").get("return_url") === "http://localhost:5717", "portal: localhost origin accepted for dev");

  const code = await req("/functions/v1/referral-code", asUser(P), flipped);
  const codeBody = (await code.json()) as { code?: string };
  ok(code.status === 200 && /^PAT-[2-9A-HJ-NP-Z]{4}$/.test(codeBody.code ?? ""), `referral-code: minted NAME-XXXX (got ${codeBody.code})`);
  ok((await row(P)).referral_code === codeBody.code && (await row(P)).stripe_promotion_code_id === "promo_new", "referral-code: stored on own row");
  const again = (await (await req("/functions/v1/referral-code", asUser(P), flipped)).json()) as { code?: string };
  ok(again.code === codeBody.code, "referral-code: second call returns the same code");

  const unknown = await req("/functions/v1/apple-iap", asUser(P, { productId: "com.other.app", originalTransactionId: "otx_P" }), flipped);
  ok(unknown.status === 400, "apple-iap: unknown product 400");
  const iap = await req(
    "/functions/v1/apple-iap",
    asUser(P, { productId: "NUVO_IAP_MONTHLY", originalTransactionId: "otx_P", transactionId: "tx_1", expiresDate: 1_900_000_000_000 }),
    flipped,
  );
  ok(iap.status === 200, `apple-iap: 200 (got ${iap.status})`);
  const pr = await row(P);
  ok(pr.status === "active" && pr.plan_source === "apple" && pr.apple_original_transaction_id === "otx_P", "apple-iap: row active via apple");
  const checkoutApple = await req("/functions/v1/stripe-checkout", asUser(P, { plan: "monthly" }), flipped);
  ok(checkoutApple.status === 409, "checkout: refuses an Apple-active account");
}

// ── 7. Apple webhook: verify, dedupe, write ──────────────────────────────────
async function appleNotification(uuid: string, type: string, subtype: string | null, tx: Record<string, unknown>, opts: { txKey?: Key } = {}) {
  const signedTransactionInfo = await jws({ signedDate: Date.parse("2026-11-06T00:00:00Z"), ...tx }, { key: opts.txKey });
  return jws({
    notificationType: type,
    subtype,
    notificationUUID: uuid,
    signedDate: Date.parse("2026-11-06T00:00:00Z"),
    data: { bundleId: "day.nuvo.app", signedTransactionInfo },
  });
}
const appleReq = (signedPayload: string, secret?: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ signedPayload }),
  ...(secret ? {} : {}),
});
const txP = { bundleId: "day.nuvo.app", productId: "NUVO_IAP_MONTHLY", originalTransactionId: "otx_P", expiresDate: 1_950_000_000_000 };
{
  const expired = await appleNotification("uuid-exp-1", "EXPIRED", "VOLUNTARY", txP);

  const forged = expired.split(".");
  forged[1] = b64url(new TextEncoder().encode(JSON.stringify({ notificationType: "EXPIRED", notificationUUID: "uuid-forged", data: {} })));
  const forgedRes = await req("/api/apple-webhook", appleReq(forged.join(".")), flipped);
  ok(forgedRes.status === 400, `apple webhook: forged payload 400 (got ${forgedRes.status})`);
  ok((await row(P)).status === "active", "apple webhook: forged payload wrote nothing");

  const secretEnv = { ...flipped, APPLE_NOTIFICATION_SECRET: "s3cret" };
  const noSecret = await req("/api/apple-webhook", appleReq(expired), secretEnv);
  ok(noSecret.status === 401, "apple webhook: URL secret still enforced");

  const rogueTx = await appleNotification("uuid-rogue-tx", "EXPIRED", null, txP, { txKey: await newKey("P-256") });
  const rogueRes = await req("/api/apple-webhook", appleReq(rogueTx), flipped);
  ok(rogueRes.status === 200 && (await row(P)).status === "active", "apple webhook: unverifiable signedTransactionInfo is ignored, not written");

  const res = await req("/api/apple-webhook?secret=s3cret", appleReq(expired), secretEnv);
  ok(res.status === 200, `apple webhook: verified EXPIRED 200 (got ${res.status})`);
  ok((await row(P)).status === "cancelled", "apple webhook: EXPIRED cancels the apple row");

  await db.query(`UPDATE subscriptions SET status = 'active' WHERE user_id = $1`, [P]);
  const replay = await req("/api/apple-webhook?secret=s3cret", appleReq(expired), secretEnv);
  ok(((await replay.json()) as { duplicate?: boolean }).duplicate === true, "apple webhook: same notificationUUID → duplicate ack");
  ok((await row(P)).status === "active", "apple webhook: replay did not write again");

  const renew = await appleNotification("uuid-renew-1", "DID_RENEW", null, { ...txP, expiresDate: 1_960_000_000_000 });
  await req("/api/apple-webhook", appleReq(renew), flipped);
  const pr = await row(P);
  ok(pr.status === "active" && new Date(pr.current_period_end as string).getTime() === 1_960_000_000_000, "apple webhook: DID_RENEW extends the period");
  const ent = (await (await req("/api/entitlement", { headers: { Authorization: `Bearer ${P}` } }, flipped)).json()) as { entitled?: boolean; plan_source?: string };
  ok(ent.entitled === true && ent.plan_source === "apple", "entitlement (Neon): apple-active is entitled");

  const otherBundle = await appleNotification("uuid-bundle", "EXPIRED", null, { ...txP, bundleId: "com.someone.else" });
  await req("/api/apple-webhook", appleReq(otherBundle), flipped);
  ok((await row(P)).status === "active", "apple webhook: another bundle's notification ignored");
}

// ── 7b. appAccountToken: first purchase with no apple-iap confirm ───────────
{
  const T = "ffff0000-0000-4000-8000-00000000000f";
  // A Better Auth user whose trial row never got written.
  await db.query(`INSERT INTO "user" (id, email, name, "emailVerified") VALUES ($1, 't@billing.test', 'Tia', true)`, [T]);
  const first = await appleNotification("uuid-sub-T", "SUBSCRIBED", "INITIAL_BUY", {
    bundleId: "day.nuvo.app",
    productId: "NUVO_IAP_ANNUAL",
    originalTransactionId: "otx_T",
    expiresDate: 1_950_000_000_000,
    appAccountToken: T.replace(/-/g, "").toUpperCase(),
  });
  const res = await req("/api/apple-webhook", appleReq(first), flipped);
  ok(res.status === 200, `apple token: SUBSCRIBED 200 (got ${res.status})`);
  const t = await row(T);
  ok(t?.status === "active" && t.plan_source === "apple" && t.apple_original_transaction_id === "otx_T", "apple token: signed appAccountToken attaches a first purchase (row created, then patched)");

  // The token can't steal a lineage that is already linked.
  const hijack = await appleNotification("uuid-hijack", "EXPIRED", null, { ...txP, appAccountToken: T });
  await req("/api/apple-webhook", appleReq(hijack), flipped);
  ok((await row(P)).status === "cancelled" && (await row(T)).apple_original_transaction_id === "otx_T", "apple token: a linked lineage stays with its row");
  await db.query(`UPDATE subscriptions SET status = 'active' WHERE user_id = $1`, [P]);

  const ghost = "99990000-0000-4000-8000-000000000009";
  const unknownUser = await appleNotification("uuid-ghost", "SUBSCRIBED", null, { ...txP, originalTransactionId: "otx_ghost", appAccountToken: ghost });
  await req("/api/apple-webhook", appleReq(unknownUser), flipped);
  ok((await row(ghost)) === undefined, "apple token: an id Better Auth doesn't know never gets a row");
}

// ── 7c. CORS for credentialed and bearer callers ─────────────────────────────
{
  const cred = await req("/functions/v1/stripe-portal", { ...asUser(A), headers: { Authorization: `Bearer ${A}`, Origin: "https://app.nuvo.day" } }, flipped);
  ok(cred.headers.get("access-control-allow-origin") === "https://app.nuvo.day" && cred.headers.get("access-control-allow-credentials") === "true", "cors: app origin echoed with credentials");
  const foreign = await req("/functions/v1/stripe-portal", { ...asUser(A), headers: { Authorization: `Bearer ${A}`, Origin: "https://evil.test" } }, flipped);
  ok(foreign.headers.get("access-control-allow-origin") === "*" && foreign.headers.get("access-control-allow-credentials") === null, "cors: foreign origin gets * and no credentials");
  const pre = await req("/functions/v1/stripe-checkout", { method: "OPTIONS", headers: { Origin: "https://app.nuvo.day" } }, flipped);
  ok(pre.headers.get("access-control-allow-origin") === "https://app.nuvo.day", "cors: preflight echoes the app origin");
  const unflipped = await req("/functions/v1/stripe-checkout", { ...asUser(A), headers: { Origin: "https://app.nuvo.day" } }, baseEnv);
  ok(unflipped.status === 503 && unflipped.headers.get("access-control-allow-origin") === "https://app.nuvo.day", "cors: pre-flip 503 is still readable by the app");
}

// ── 8. Sign-up trial + delete wipes the billing row ──────────────────────────
{
  const NEW = "dddd0000-0000-4000-8000-00000000000d";
  await db.query(`INSERT INTO "user" (id, email, name, "emailVerified") VALUES ($1, 'new@billing.test', 'New', true)`, [NEW]);
  const first = await req("/api/data/domains", { headers: { Authorization: `Bearer ${NEW}` } }, flipped);
  ok(first.status === 200, `sign-up: first request 200 (got ${first.status})`);
  const t = await row(NEW);
  ok(t?.status === "trialing" && new Date(t.trial_ends_at as string).getTime() > Date.now() + 13 * 86_400_000, "sign-up: 14-day trial row on Neon");
  const ent = (await (await req("/api/entitlement", { headers: { Authorization: `Bearer ${NEW}` } }, flipped)).json()) as { entitled?: boolean; plan?: string };
  ok(ent.entitled === true && ent.plan === "trialing", "entitlement: new account entitled by its trial");

  await wipeOwnedAccount(sql, { plannerUserId: NEW, authUserId: NEW, billingOnNeon: true });
  ok((await row(NEW)) === undefined, "delete: billing row removed with the account");
  ok((await row(A)) !== undefined, "delete: other accounts' billing untouched");
}

restoreBilling();
restoreIo();
await db.close();

if (fails.length) {
  for (const f of fails) console.error(`  FAIL ${f}`);
}
console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) process.exit(1);
