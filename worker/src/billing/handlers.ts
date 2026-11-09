/**
 * Billing on the Worker — the port of the Supabase edge functions
 * `stripe-checkout`, `stripe-portal`, `stripe-webhook`, `apple-iap`,
 * `apple-webhook`, `iap-catalog` and `referral-code`.
 *
 * Same requests out to Stripe, same rows written, now on Neon. Differences
 * from the Supabase versions are all hardening, never a new rule:
 *   · Apple notifications are JWS-verified (x5c chain to Apple Root CA G3),
 *     not just base64-decoded.
 *   · The referral reward is claimed with a conditional UPDATE before Stripe
 *     is called, and the balance credit carries a Stripe idempotency key, so
 *     `invoice.paid` racing `checkout.session.completed` (or a replay across
 *     the cutover) can never credit twice.
 *   · `referral_uses` increments in SQL, not read-modify-write.
 *
 * Every handler here assumes the router already checked the cutover flip.
 */
import type { Sql } from "../db.ts";
import type { Env } from "../env.ts";
import {
  appleNotificationToPlan,
  configuredIapProductIds,
  iapEnvFrom,
  isOurIapProduct,
  stripeStatusToPlan,
} from "../../../supabase/functions/_shared/planRules.ts";
import { resolveReturnOriginFrom } from "../../../supabase/functions/_shared/billingReturn.ts";
import {
  personalReferralCode,
  randomReferralSuffix,
  slugFromUser,
} from "../../../supabase/functions/_shared/referralCode.ts";
import {
  monthsCreditRemaining,
  REFERRAL_MONTHLY_CREDIT_CENTS,
} from "../../../supabase/functions/_shared/referralOffer.ts";
import { pushToAccount } from "../pushDispatch.ts";
import { AppleJwsError, verifyAppleJws, type AppleJwsOptions } from "./appleJws.ts";
import {
  appleTokenMayAttach,
  confirmAppleTransaction,
  iapRejectionBody,
  parseAppAccountToken,
} from "../../../supabase/functions/_shared/appleIap.ts";
import { appStoreApiCredentialsFrom } from "../../../supabase/functions/_shared/appStoreServerApi.ts";
import {
  applyPlanUpdate,
  claimWebhookEvent,
  logBilling,
  releaseWebhookEvent,
} from "./db.ts";
import {
  stripeClient,
  StripeSignatureError,
  verifyStripeEvent,
  type FetchLike,
  type StripeClient,
} from "./stripeApi.ts";

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

export interface BillingDeps {
  sql: Sql;
  env: Env;
  fetchImpl?: FetchLike;
  /** Tests: pin the Apple root to a generated CA. */
  appleJws?: AppleJwsOptions;
  /** Tests: fixed clock for the Stripe signature tolerance. */
  nowSeconds?: number;
}

export interface BillingUser {
  id: string;
  email?: string | null;
}

export function billingJson(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Apple sends expiresDate as epoch ms (number or numeric string). */
function appleDateToIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && /^\d+$/.test(value)) return new Date(Number(value)).toISOString();
  return null;
}

/** StoreKit `appAccountToken` → normalized user id. One definition, in `_shared/appleIap.ts`. */
export { parseAppAccountToken };

function stripeFor(deps: BillingDeps): StripeClient {
  return stripeClient(deps.env.STRIPE_SECRET_KEY ?? "", deps.fetchImpl ?? fetch);
}

function idOf(ref: unknown): string | null {
  if (typeof ref === "string" && ref) return ref;
  if (ref && typeof ref === "object" && typeof (ref as Obj).id === "string") return (ref as Obj).id;
  return null;
}

type SubRow = {
  stripe_customer_id: string | null;
  status: string | null;
  plan_source: string | null;
  referral_code: string | null;
  stripe_promotion_code_id: string | null;
};

async function ownRow(sql: Sql, userId: string): Promise<SubRow | null> {
  const rows = (await sql`
    SELECT stripe_customer_id, status, plan_source, referral_code, stripe_promotion_code_id
    FROM subscriptions WHERE user_id = ${userId}::uuid LIMIT 1
  `) as SubRow[];
  return rows[0] ?? null;
}

// ── stripe-checkout ──────────────────────────────────────────────────────────

export async function handleCheckout(deps: BillingDeps, user: BillingUser, body: Obj): Promise<Response> {
  const plan = body?.plan;
  if (plan !== "monthly" && plan !== "annual") {
    return billingJson({ error: "plan must be 'monthly' or 'annual'" }, 400);
  }
  const priceId = (plan === "annual" ? deps.env.STRIPE_PRICE_ANNUAL : deps.env.STRIPE_PRICE_MONTHLY)?.trim();
  if (!priceId) return billingJson({ error: "Checkout is not configured" }, 503);

  const existing = await ownRow(deps.sql, user.id);
  if (existing?.status === "active" && existing.plan_source === "apple") {
    return billingJson({ error: "Already subscribed through the App Store" }, 409);
  }
  const appUrl = resolveReturnOriginFrom(body?.origin, deps.env.APP_URL);
  const stripe = stripeFor(deps);

  // Friend code: Stripe forbids `discounts` with `allow_promotion_codes`, so pick one path.
  let discounts: { promotion_code: string }[] | undefined;
  let allowPromotionCodes = true;
  const rawCode = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (rawCode) {
    const listed = await stripe.get<{ data: Obj[] }>("/v1/promotion_codes", { code: rawCode, limit: 1, active: true });
    const promo = listed.data?.[0];
    const referrer = promo?.metadata?.referrer_user_id;
    const isOurs = promo?.metadata?.app === "nuvo" && promo?.metadata?.kind === "referral";
    if (promo && isOurs && referrer && referrer !== user.id) {
      discounts = [{ promotion_code: promo.id }];
      allowPromotionCodes = false;
    }
  }

  const session = await stripe.post<{ url: string }>("/v1/checkout/sessions", {
    mode: "subscription",
    customer: existing?.stripe_customer_id ?? undefined,
    customer_email: existing?.stripe_customer_id ? undefined : (user.email ?? undefined),
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: user.id,
    metadata: { app: "nuvo", user_id: user.id },
    subscription_data: { metadata: { app: "nuvo", user_id: user.id } },
    success_url: `${appUrl}/?checkout=success`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    ...(discounts ? { discounts } : {}),
    allow_promotion_codes: allowPromotionCodes,
  });
  return billingJson({ url: session.url });
}

// ── stripe-portal ────────────────────────────────────────────────────────────

export async function handlePortal(deps: BillingDeps, user: BillingUser, body: Obj): Promise<Response> {
  const row = await ownRow(deps.sql, user.id);
  if (row?.plan_source === "apple" && !row.stripe_customer_id) {
    return billingJson({ error: "This subscription is managed through the App Store." }, 409);
  }
  if (!row?.stripe_customer_id) {
    return billingJson({ error: "No billing account yet — subscribe first." }, 404);
  }
  const session = await stripeFor(deps).post<{ url: string }>("/v1/billing_portal/sessions", {
    customer: row.stripe_customer_id,
    return_url: resolveReturnOriginFrom(body?.origin, deps.env.APP_URL),
  });
  return billingJson({ url: session.url });
}

// ── iap-catalog ──────────────────────────────────────────────────────────────

export function handleIapCatalog(env: Env): Response {
  const ids = configuredIapProductIds(iapEnvFrom((k) => (env as Record<string, string | undefined>)[k]));
  return billingJson({ monthly: ids.monthly, annual: ids.annual });
}

// ── apple-iap ────────────────────────────────────────────────────────────────

/**
 * Same decision as Supabase's `apple-iap` — literally: both call
 * `confirmAppleTransaction` (_shared/appleIap.ts). The purchase's product,
 * expiry, bundle, environment, ids, appAccountToken and revocation come only
 * from an App Store JWS verified to Apple Root CA - G3: the device's StoreKit 2
 * `jwsRepresentation` (1.2+), or for 1.1 binaries the `signedTransactionInfo`
 * the App Store Server API returns for `transactionId` (APPLE_IAP_* bindings;
 * unset → 503, never a trusted body). Renewals and refunds arrive verified
 * through the App Store webhook.
 */
export async function handleAppleIap(deps: BillingDeps, user: BillingUser, body: Obj): Promise<Response> {
  const { sql } = deps;
  const get = (k: string) => (deps.env as Record<string, string | undefined>)[k];
  const verdict = await confirmAppleTransaction(body, user.id, {
    bundleId: deps.env.APPLE_BUNDLE_ID?.trim() || null,
    iapEnv: iapEnvFrom(get),
    apiCredentials: appStoreApiCredentialsFrom(get),
    jwsOptions: deps.appleJws,
    fetchImpl: deps.fetchImpl,
    ownerOfOriginalTransaction: async (otx) => {
      const rows = (await sql`
        SELECT user_id::text AS user_id FROM subscriptions WHERE apple_original_transaction_id = ${otx} LIMIT 1
      `) as { user_id: string }[];
      return rows[0]?.user_id ?? null;
    },
  });
  if (!verdict.ok) {
    await logBilling(sql, "apple", "apple-iap", "error", `refused: ${verdict.code}`, user.id);
    return billingJson(iapRejectionBody(verdict), verdict.status);
  }
  const result = await applyPlanUpdate(sql, verdict.write);
  if (!result.applied) return billingJson({ error: "no subscription row" }, 404);
  return billingJson({
    ok: true,
    transactionId: verdict.tx.transactionId,
    originalTransactionId: verdict.tx.originalTransactionId,
    environment: verdict.tx.environment,
  });
}

// ── referral-code ────────────────────────────────────────────────────────────

export async function handleReferralCode(deps: BillingDeps, user: BillingUser): Promise<Response> {
  const couponId = deps.env.STRIPE_REFERRAL_COUPON?.trim();
  if (!couponId) return billingJson({ error: "Referral codes are not configured yet" }, 503);
  const { sql } = deps;
  const row = await ownRow(sql, user.id);
  if (row?.referral_code && row?.stripe_promotion_code_id) return billingJson({ code: row.referral_code });

  const stripe = stripeFor(deps);
  if (!row?.referral_code) {
    const existing = await stripe.get<{ data: Obj[] }>("/v1/promotion_codes", { limit: 100, coupon: couponId });
    const mine = existing.data?.find((p) => p.metadata?.app === "nuvo" && p.metadata?.referrer_user_id === user.id);
    if (mine?.code) {
      await sql`
        UPDATE subscriptions SET referral_code = ${mine.code}, stripe_promotion_code_id = ${mine.id}
        WHERE user_id = ${user.id}::uuid
      `;
      return billingJson({ code: mine.code });
    }
  }

  const names = (await sql`SELECT name, email FROM "user" WHERE id = ${user.id} LIMIT 1`) as {
    name: string | null;
    email: string | null;
  }[];
  const base = slugFromUser({
    user_metadata: names[0]?.name ? { full_name: names[0].name } : {},
    email: names[0]?.email ?? user.email ?? null,
  });
  let promo: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = personalReferralCode(base, randomReferralSuffix());
    try {
      const created = await stripe.post<{ id: string; code: string }>("/v1/promotion_codes", {
        coupon: couponId,
        code,
        metadata: { app: "nuvo", kind: "referral", referrer_user_id: user.id },
      });
      promo = { id: created.id, code: created.code };
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already|exists|taken|duplicate/i.test(msg)) throw e;
    }
  }
  if (!promo) return billingJson({ error: "Could not mint a unique code" }, 500);
  await sql`
    UPDATE subscriptions SET referral_code = ${promo.code}, stripe_promotion_code_id = ${promo.id}
    WHERE user_id = ${user.id}::uuid
  `;
  return billingJson({ code: promo.code });
}

// ── referral notices (push + email), best effort ─────────────────────────────

async function notifyReferral(deps: BillingDeps, referrerAuthId: string, kind: "referral_use" | "referral_credit") {
  const msg = kind === "referral_use"
    ? { title: "A friend used your Nuvo code", body: "Nice. You’ll get a free month when they pay — up to 6." }
    : { title: "You earned a free month of Nuvo", body: "A friend paid with your code. $29 credit lands on your next invoice." };
  const { sql, env } = deps;
  try {
    const planner = (await sql`
      SELECT id::text AS id FROM users WHERE auth_id = ${referrerAuthId}::uuid OR id = ${referrerAuthId}::uuid
      ORDER BY (auth_id = ${referrerAuthId}::uuid) DESC NULLS LAST LIMIT 1
    `) as { id: string }[];
    if (planner[0]) {
      await pushToAccount(sql, env, planner[0].id, { ...msg, key: `${kind}-${Date.now()}`, url: "/" }, deps.fetchImpl);
    }
  } catch {
    /* a notice never fails the webhook */
  }
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return;
  try {
    const rows = (await sql`SELECT email FROM "user" WHERE id = ${referrerAuthId} LIMIT 1`) as { email: string | null }[];
    const to = rows[0]?.email;
    if (!to) return;
    const appUrl = env.APP_URL?.trim() || "https://app.nuvo.day";
    const res = await (deps.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Nuvo <hello@nuvo.day>",
        to: [to],
        subject: msg.title,
        text: `${msg.body}\n\nSettings → Billing: ${appUrl}\n`,
      }),
    });
    await logBilling(sql, "stripe", `${kind}_email`, res.ok ? "ok" : "error", res.ok ? null : `${res.status}`, referrerAuthId);
  } catch (e) {
    await logBilling(sql, "stripe", `${kind}_email`, "error", e instanceof Error ? e.message : String(e), referrerAuthId);
  }
}

// ── stripe-webhook ───────────────────────────────────────────────────────────

function nuvoPrices(env: Env): Set<string> {
  return new Set([env.STRIPE_PRICE_MONTHLY, env.STRIPE_PRICE_ANNUAL].map((p) => p?.trim()).filter(Boolean) as string[]);
}

function isOurSubscription(sub: Obj, prices: Set<string>): boolean {
  if (sub?.metadata?.app === "nuvo") return true;
  return (sub?.items?.data ?? []).some((i: Obj) => i?.price?.id && prices.has(i.price.id));
}

function invoiceIsOurs(invoice: Obj, prices: Set<string>): boolean {
  return (invoice?.lines?.data ?? []).some((l: Obj) => {
    const id = l?.price?.id ?? l?.pricing?.price_details?.price;
    return typeof id === "string" && prices.has(id);
  });
}

function periodEndISO(sub: Obj): string | null {
  const secs = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end;
  if (typeof secs !== "number" || !Number.isFinite(secs)) return null;
  return new Date(secs * 1000).toISOString();
}

function acceptPromo(promo: Obj | null | undefined, checkoutUserId: string): { referrerUserId: string; code: string } | null {
  if (promo?.metadata?.app !== "nuvo" || promo?.metadata?.kind !== "referral") return null;
  const referrer = promo.metadata?.referrer_user_id;
  if (typeof referrer !== "string" || !referrer || referrer === checkoutUserId) return null;
  const code = typeof promo.code === "string" ? promo.code : null;
  return code ? { referrerUserId: referrer, code } : null;
}

async function referralFromCheckout(stripe: StripeClient, session: Obj) {
  const userId = session.client_reference_id ?? session.metadata?.user_id;
  if (!userId) return null;
  try {
    const full = await stripe.get<Obj>(`/v1/checkout/sessions/${encodeURIComponent(session.id)}`, {
      expand: ["total_details.breakdown.discounts.discount.promotion_code"],
    });
    const discounts = full?.total_details?.breakdown?.discounts as Obj[] | undefined;
    const promo = discounts?.map((d) => d?.discount?.promotion_code).find((p) => p && typeof p === "object");
    if (!promo) {
      for (const d of (full?.discounts ?? []) as Obj[]) {
        const p = typeof d?.promotion_code === "object" ? d.promotion_code : null;
        if (p) return acceptPromo(p, userId);
      }
      return null;
    }
    return acceptPromo(promo, userId);
  } catch {
    return null;
  }
}

async function referralFromInvoice(stripe: StripeClient, invoice: Obj, checkoutUserId: string) {
  try {
    const inv = await stripe.get<Obj>(`/v1/invoices/${encodeURIComponent(invoice.id)}`, {
      expand: ["discounts.promotion_code", "discount.promotion_code"],
    });
    const candidates: unknown[] = [];
    if (Array.isArray(inv.discounts)) {
      for (const d of inv.discounts) if (d && typeof d === "object" && "promotion_code" in d) candidates.push(d.promotion_code);
    }
    if (inv.discount?.promotion_code) candidates.push(inv.discount.promotion_code);
    for (const raw of candidates) {
      const promo = typeof raw === "string" ? await stripe.get<Obj>(`/v1/promotion_codes/${encodeURIComponent(raw)}`) : (raw as Obj);
      const accepted = acceptPromo(promo, checkoutUserId);
      if (accepted) return accepted;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Trial sharers may never have checked out — make a customer so the credit has somewhere to land. */
async function ensureStripeCustomer(deps: BillingDeps, stripe: StripeClient, userId: string, existingId: string | null) {
  if (existingId) {
    try {
      const cust = await stripe.get<Obj>(`/v1/customers/${encodeURIComponent(existingId)}`);
      if (!cust.deleted) return existingId;
    } catch {
      /* recreate below */
    }
  }
  const users = (await deps.sql`SELECT email FROM "user" WHERE id = ${userId} LIMIT 1`) as { email: string | null }[];
  if (!users[0]) {
    await logBilling(deps.sql, "stripe", "referral_ensure_customer", "error", "user not found", userId);
    return null;
  }
  const customer = await stripe.post<{ id: string }>("/v1/customers", {
    email: users[0].email ?? undefined,
    metadata: { app: "nuvo", user_id: userId },
  });
  await deps.sql`UPDATE subscriptions SET stripe_customer_id = ${customer.id} WHERE user_id = ${userId}::uuid`;
  return customer.id;
}

type FriendRow = {
  user_id: string;
  referred_by: string | null;
  referral_reward_granted_at: string | null;
  referral_code_used: string | null;
};

async function loadFriendForInvoice(deps: BillingDeps, stripe: StripeClient, invoice: Obj, customerId: string) {
  const { sql } = deps;
  const byCustomer = (await sql`
    SELECT user_id::text AS user_id, referred_by::text AS referred_by, referral_reward_granted_at, referral_code_used
    FROM subscriptions WHERE stripe_customer_id = ${customerId} LIMIT 1
  `) as FriendRow[];
  if (byCustomer[0]) return byCustomer[0];
  const subId = idOf(invoice.subscription);
  if (!subId) return null;
  try {
    const sub = await stripe.get<Obj>(`/v1/subscriptions/${encodeURIComponent(subId)}`);
    const userId = sub.metadata?.user_id;
    if (typeof userId !== "string" || !userId) return null;
    const byUser = (await sql`
      SELECT user_id::text AS user_id, referred_by::text AS referred_by, referral_reward_granted_at,
             referral_code_used, stripe_customer_id
      FROM subscriptions WHERE user_id = ${userId}::uuid LIMIT 1
    `) as (FriendRow & { stripe_customer_id: string | null })[];
    const row = byUser[0];
    if (!row) return null;
    if (!row.stripe_customer_id) {
      await sql`UPDATE subscriptions SET stripe_customer_id = ${customerId} WHERE user_id = ${userId}::uuid`;
    }
    return {
      user_id: row.user_id,
      referred_by: row.referred_by,
      referral_reward_granted_at: row.referral_reward_granted_at,
      referral_code_used: row.referral_code_used,
    };
  } catch {
    return null;
  }
}

/**
 * Attribute a friend to a code exactly once. The conditional UPDATE is the
 * "first time" check, so two racing events cannot both bump the count.
 */
async function attributeOnce(deps: BillingDeps, friendId: string, ref: { referrerUserId: string; code: string }) {
  const won = await deps.sql`
    UPDATE subscriptions SET referred_by = ${ref.referrerUserId}::uuid, referral_code_used = ${ref.code}
    WHERE user_id = ${friendId}::uuid AND referred_by IS NULL
    RETURNING user_id
  `;
  if (!won.length) return false;
  await deps.sql`
    UPDATE subscriptions SET referral_uses = referral_uses + 1, referral_last_use_at = now()
    WHERE user_id = ${ref.referrerUserId}::uuid
  `;
  await notifyReferral(deps, ref.referrerUserId, "referral_use");
  return true;
}

/** Friend paid → one free month for the referrer, under the 6-month cap, at most once per friend. */
async function maybeCreditReferrer(deps: BillingDeps, stripe: StripeClient, invoice: Obj): Promise<void> {
  const { sql } = deps;
  if (invoice?.status !== "paid") return;
  if (!invoiceIsOurs(invoice, nuvoPrices(deps.env))) return;
  const reason = invoice.billing_reason as string | undefined;
  if (reason && reason !== "subscription_create") return;
  const customerId = idOf(invoice.customer);
  if (!customerId) return;

  let friend = await loadFriendForInvoice(deps, stripe, invoice, customerId);
  if (!friend || friend.referral_reward_granted_at) return;

  if (!friend.referred_by) {
    const recovered = await referralFromInvoice(stripe, invoice, friend.user_id);
    if (!recovered) return;
    await attributeOnce(deps, friend.user_id, recovered);
    const reread = (await sql`
      SELECT referred_by::text AS referred_by, referral_code_used FROM subscriptions WHERE user_id = ${friend.user_id}::uuid
    `) as { referred_by: string | null; referral_code_used: string | null }[];
    friend = { ...friend, referred_by: reread[0]?.referred_by ?? null, referral_code_used: reread[0]?.referral_code_used ?? null };
    if (!friend.referred_by) return;
  }

  const referrerUserId = friend.referred_by!;
  const referrers = (await sql`
    SELECT user_id::text AS user_id, stripe_customer_id FROM subscriptions WHERE user_id = ${referrerUserId}::uuid LIMIT 1
  `) as { user_id: string; stripe_customer_id: string | null }[];
  const referrer = referrers[0];
  if (!referrer) {
    await logBilling(sql, "stripe", "referral_credit_skipped", "error", "referrer row missing", referrerUserId);
    return;
  }

  // Claim the reward before touching Stripe: only one delivery wins.
  const claimed = await sql`
    UPDATE subscriptions SET referral_reward_granted_at = now()
    WHERE user_id = ${friend.user_id}::uuid AND referral_reward_granted_at IS NULL
    RETURNING user_id
  `;
  if (!claimed.length) return;

  try {
    const stripeCustomerId = await ensureStripeCustomer(deps, stripe, referrer.user_id, referrer.stripe_customer_id);
    if (!stripeCustomerId) {
      await sql`UPDATE subscriptions SET referral_reward_granted_at = NULL WHERE user_id = ${friend.user_id}::uuid`;
      return;
    }
    const cust = await stripe.get<Obj>(`/v1/customers/${encodeURIComponent(stripeCustomerId)}`);
    if (cust.deleted) {
      await sql`UPDATE subscriptions SET referral_reward_granted_at = NULL WHERE user_id = ${friend.user_id}::uuid`;
      return;
    }
    const balance = typeof cust.balance === "number" ? cust.balance : 0;
    if (monthsCreditRemaining(balance) < 1) {
      // Same as Supabase: capped still counts as "rewarded" for this friend.
      await logBilling(sql, "stripe", "referral_credit_capped", "ok", "referrer already at 6 months outstanding credit", referrerUserId);
      return;
    }
    await stripe.post(
      `/v1/customers/${encodeURIComponent(stripeCustomerId)}/balance_transactions`,
      {
        amount: -REFERRAL_MONTHLY_CREDIT_CENTS,
        currency: "usd",
        description: `Nuvo friend-code reward (${friend.referral_code_used ?? "code"} → paid)`,
        metadata: { app: "nuvo", kind: "referral_reward", referred_user_id: friend.user_id, invoice_id: invoice.id },
      },
      // One reward per referred friend, ever — a replay across runtimes reuses Stripe's answer.
      { idempotencyKey: `nuvo-referral-reward-${friend.user_id}` },
    );
  } catch (e) {
    await sql`UPDATE subscriptions SET referral_reward_granted_at = NULL WHERE user_id = ${friend.user_id}::uuid`;
    throw e;
  }

  await sql`
    UPDATE subscriptions SET referral_credits_earned = referral_credits_earned + 1, referral_last_credit_at = now()
    WHERE user_id = ${referrerUserId}::uuid
  `;
  await logBilling(sql, "stripe", "referral_credit", "ok", null, referrerUserId);
  await notifyReferral(deps, referrerUserId, "referral_credit");
}

export async function handleStripeWebhook(deps: BillingDeps, req: Request): Promise<Response> {
  const raw = await req.text();
  let event: Obj;
  try {
    event = await verifyStripeEvent<Obj>(raw, req.headers.get("stripe-signature"), deps.env.STRIPE_WEBHOOK_SECRET, deps.nowSeconds);
  } catch (e) {
    const msg = e instanceof StripeSignatureError ? e.message : "invalid";
    return new Response(`signature verification failed: ${msg}`, { status: 400 });
  }
  const eventId = asString(event.id);
  const type = asString(event.type) ?? "";
  if (!eventId) return new Response("event has no id", { status: 400 });

  const { sql } = deps;
  if (!(await claimWebhookEvent(sql, "stripe_webhook_events", eventId))) {
    return billingJson({ received: true, duplicate: true });
  }

  const prices = nuvoPrices(deps.env);
  try {
    const stripe = stripeFor(deps);
    const obj = (event.data?.object ?? {}) as Obj;
    switch (type) {
      case "checkout.session.completed": {
        if (obj.metadata?.app !== "nuvo") break;
        const userId = asString(obj.client_reference_id);
        const customerId = idOf(obj.customer);
        if (userId && customerId) {
          await sql`UPDATE subscriptions SET stripe_customer_id = ${customerId} WHERE user_id = ${userId}::uuid`;
        }
        if (userId) {
          const ref = await referralFromCheckout(stripe, obj);
          if (ref) await attributeOnce(deps, userId, ref);
        }
        // invoice.paid may have fired first (or arrive out of order) — credit now.
        const invId = idOf(obj.invoice);
        if (invId) {
          const inv = await stripe.get<Obj>(`/v1/invoices/${encodeURIComponent(invId)}`);
          await maybeCreditReferrer(deps, stripe, inv);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        if (!isOurSubscription(obj, prices)) break;
        await applyPlanUpdate(sql, {
          userId: asString(obj.metadata?.user_id) ?? undefined,
          plan: stripeStatusToPlan(String(obj.status)),
          planSource: "stripe",
          stripeSubscriptionId: obj.id,
          stripeCustomerId: idOf(obj.customer),
          priceId: obj.items?.data?.[0]?.price?.id ?? null,
          currentPeriodEnd: periodEndISO(obj),
          cancelAtPeriodEnd: obj.cancel_at_period_end === true,
        });
        break;
      }
      case "customer.subscription.deleted": {
        if (!isOurSubscription(obj, prices)) break;
        await applyPlanUpdate(sql, {
          userId: asString(obj.metadata?.user_id) ?? undefined,
          plan: "cancelled",
          planSource: "stripe",
          stripeSubscriptionId: obj.id,
          stripeCustomerId: idOf(obj.customer),
          cancelAtPeriodEnd: false,
        });
        break;
      }
      case "invoice.paid":
        await maybeCreditReferrer(deps, stripe, obj);
        break;
      case "invoice.payment_failed":
        if (invoiceIsOurs(obj, prices)) await logBilling(sql, "stripe", "invoice.payment_failed", "ok");
        break;
      default:
        break;
    }
  } catch (e) {
    await releaseWebhookEvent(sql, "stripe_webhook_events", eventId);
    await logBilling(sql, "stripe", type || "event", "error", e instanceof Error ? e.message : String(e));
    return billingJson({ error: "handler failed" }, 500);
  }
  return billingJson({ received: true });
}

// ── apple-webhook ────────────────────────────────────────────────────────────

function notificationSecretOk(env: Env, req: Request): boolean {
  const secret = env.APPLE_NOTIFICATION_SECRET?.trim();
  if (!secret) return true;
  try {
    return new URL(req.url).searchParams.get("secret") === secret;
  } catch {
    return false;
  }
}

export async function handleAppleWebhook(deps: BillingDeps, req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!notificationSecretOk(deps.env, req)) return new Response("unauthorized", { status: 401 });

  const raw = await req.json().catch(() => null);
  const signedPayload = asString((raw as { signedPayload?: unknown } | null)?.signedPayload);
  if (!signedPayload) return new Response("missing signedPayload", { status: 400 });

  let notification: Obj;
  try {
    notification = await verifyAppleJws(signedPayload, deps.appleJws);
  } catch (e) {
    const msg = e instanceof AppleJwsError ? e.message : "invalid";
    return new Response(`invalid signedPayload: ${msg}`, { status: 400 });
  }

  const { sql } = deps;
  const notificationUUID = asString(notification.notificationUUID);
  const notificationType = asString(notification.notificationType) ?? "";

  // Ledger claim and row write commit together, in ONE transaction, and every
  // DB call sits inside this try. A DB error anywhere — including the claim
  // itself — rolls the claim back and answers a generic 500, so Apple's retry
  // (it retries any non-200) runs the notification again instead of finding
  // a claimed-but-never-processed event and acking it as a duplicate. The
  // previous "claim, then DELETE on failure" left the claim behind whenever
  // the release failed too. Concurrent duplicates block on the ledger's
  // primary key until the first commits, then see the claim and ack.
  try {
    return await sql.begin(async (tx) => {
      const txSql = tx as unknown as Sql;
      if (notificationUUID && !(await claimWebhookEvent(txSql, "apple_webhook_events", notificationUUID))) {
        return billingJson({ received: true, duplicate: true });
      }
      return await applyAppleNotification(deps, txSql, notification, notificationType);
    });
  } catch (e) {
    await logBilling(sql, "apple", "notification", "error", e instanceof Error ? e.name : "error");
    return billingJson({ error: "handler failed" }, 500);
  }
}

async function applyAppleNotification(deps: BillingDeps, sql: Sql, notification: Obj, notificationType: string): Promise<Response> {
  const mapped = appleNotificationToPlan(notificationType, asString(notification.subtype));
  if (!mapped) return billingJson({ received: true, ignored: true });

  const data = notification.data;
  const signedTx = data && typeof data === "object" ? asString((data as Obj).signedTransactionInfo) : null;
  if (!signedTx) return billingJson({ received: true, ignored: true });

  let tx: Obj;
  try {
    tx = await verifyAppleJws(signedTx, deps.appleJws);
  } catch {
    // The envelope verified but the transaction didn't — never write from it.
    await logBilling(sql, "apple", notificationType, "error", "signedTransactionInfo failed verification");
    return billingJson({ received: true, ignored: true });
  }

  const bundle = deps.env.APPLE_BUNDLE_ID?.trim() || null;
  const txBundle = asString(tx.bundleId);
  if (bundle && txBundle && txBundle !== bundle) return billingJson({ received: true, ignored: true });

  const productId = asString(tx.productId);
  const iapEnv = iapEnvFrom((k) => (deps.env as Record<string, string | undefined>)[k]);
  if (iapEnv.NUVO_IAP_MONTHLY || iapEnv.NUVO_IAP_ANNUAL) {
    if (!isOurIapProduct(productId, iapEnv)) return billingJson({ received: true, ignored: true });
  }

  const originalTransactionId = asString(tx.originalTransactionId);
  if (!originalTransactionId) return billingJson({ received: true, ignored: true });

  // A row already linked to this lineage is never remapped by the token. An
  // unlinked lineage attaches by token only to an account with no Apple
  // purchase of its own that isn't paying on Stripe (`appleTokenMayAttach`,
  // QA2 #129 S2) — otherwise nothing moves and the confirm path decides.
  const linked = await sql`
    SELECT 1 FROM subscriptions WHERE apple_original_transaction_id = ${originalTransactionId} LIMIT 1
  `;
  let tokenUser: string | undefined;
  const token = linked.length ? null : parseAppAccountToken(tx.appAccountToken);
  if (token) {
    const target = (await sql`
      SELECT apple_original_transaction_id, status, plan_source, stripe_subscription_id
      FROM subscriptions WHERE user_id = ${token}::uuid LIMIT 1
    `) as { apple_original_transaction_id: string | null; status: string | null; plan_source: string | null; stripe_subscription_id: string | null }[];
    if (appleTokenMayAttach(target[0] ?? null)) tokenUser = token;
    else await logBilling(sql, "apple", notificationType, "ok", "appAccountToken not applied: account linked or on another rail");
  }

  const env = asString(tx.environment)?.toLowerCase();
  const result = await applyPlanUpdate(sql, {
    userId: tokenUser,
    plan: mapped.plan,
    planSource: "apple",
    currentPeriodEnd: appleDateToIso(tx.expiresDate),
    cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
    appleOriginalTransactionId: originalTransactionId,
    appleProductId: productId,
    ...(env === "production" || env === "sandbox" ? { appleEnvironment: env } : {}),
  });
  if (!result.applied) await logBilling(sql, "apple", notificationType, "ok", "no matching subscription row");
  return billingJson({ received: true });
}
