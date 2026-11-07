/**
 * Billing's Neon writes — the Worker twin of `_shared/plan.ts` + the
 * idempotency ledgers + `logSync`.
 *
 * `subscriptions.user_id` is the preserved auth id (Better Auth `user.id` =
 * GoTrue `auth.users.id`), exactly the key the Supabase table used. The
 * patch itself comes from the kernel (`planRowPatch`), so the two runtimes
 * cannot disagree about which rail wins.
 */
import type { Sql } from "../db.ts";
import {
  planOf,
  planRowPatch,
  type PlanSource,
  type PlanState,
  type PlanWrite,
} from "../../../supabase/functions/_shared/planRules.ts";

export type { PlanWrite };

type SubLookup = { user_id: string; status: PlanState; plan_source: PlanSource | null };

async function findBy(sql: Sql, column: string, value: string): Promise<SubLookup | null> {
  let rows: SubLookup[];
  switch (column) {
    case "user_id":
      rows = (await sql`SELECT user_id::text AS user_id, status, plan_source FROM subscriptions WHERE user_id = ${value}::uuid LIMIT 1`) as SubLookup[];
      break;
    case "apple_original_transaction_id":
      rows = (await sql`SELECT user_id::text AS user_id, status, plan_source FROM subscriptions WHERE apple_original_transaction_id = ${value} LIMIT 1`) as SubLookup[];
      break;
    case "stripe_customer_id":
      rows = (await sql`SELECT user_id::text AS user_id, status, plan_source FROM subscriptions WHERE stripe_customer_id = ${value} LIMIT 1`) as SubLookup[];
      break;
    case "stripe_subscription_id":
      rows = (await sql`SELECT user_id::text AS user_id, status, plan_source FROM subscriptions WHERE stripe_subscription_id = ${value} LIMIT 1`) as SubLookup[];
      break;
    default:
      throw new Error("unknown lookup column");
  }
  return rows[0] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same lookup order as `_shared/plan.ts` `findRow`. */
async function findRow(sql: Sql, incoming: PlanWrite & { userId?: string }): Promise<SubLookup | null> {
  if (incoming.userId && UUID_RE.test(incoming.userId)) {
    const row = await findBy(sql, "user_id", incoming.userId);
    if (row) return row;
  }
  if (incoming.appleOriginalTransactionId) {
    const row = await findBy(sql, "apple_original_transaction_id", incoming.appleOriginalTransactionId);
    if (row) return row;
  }
  if (incoming.stripeCustomerId) {
    const row = await findBy(sql, "stripe_customer_id", incoming.stripeCustomerId);
    if (row) return row;
  }
  if (incoming.stripeSubscriptionId) {
    const row = await findBy(sql, "stripe_subscription_id", incoming.stripeSubscriptionId);
    if (row) return row;
  }
  return null;
}

/**
 * Apply a rail's verdict to the one entitlement row. Never inserts — trials
 * are created at sign-up, never by a webhook (same as Supabase).
 */
export async function applyPlanUpdate(
  sql: Sql,
  incoming: PlanWrite & { userId?: string },
): Promise<{ applied: boolean; userId?: string }> {
  let existing = await findRow(sql, incoming);
  // A verified id with no row (sign-up's trial insert failed, or an account
  // the copy missed): write the default trial first, then patch — same as
  // PR #120's Supabase `plan.ts`. Only for an id Better Auth knows.
  if (!existing && incoming.userId && UUID_RE.test(incoming.userId)) {
    const known = await sql`SELECT 1 FROM "user" WHERE id = ${incoming.userId} LIMIT 1`;
    if (known.length) {
      await ensureTrialSubscription(sql, incoming.userId);
      existing = await findRow(sql, incoming);
    }
  }
  if (!existing) return { applied: false };
  const patch = planRowPatch(
    { plan: planOf(existing) ?? existing.status, planSource: existing.plan_source },
    incoming,
  );
  if (Object.keys(patch).length === 0) return { applied: true, userId: existing.user_id };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k);
  const val = (k: string) => (has(k) ? (patch[k] as string | boolean | null) : null);
  await sql`
    UPDATE subscriptions SET
      status = CASE WHEN ${has("status")} THEN ${val("status")}::text ELSE status END,
      plan_source = CASE WHEN ${has("plan_source")} THEN ${val("plan_source")}::text ELSE plan_source END,
      current_period_end = CASE WHEN ${has("current_period_end")} THEN ${val("current_period_end")}::timestamptz ELSE current_period_end END,
      cancel_at_period_end = CASE WHEN ${has("cancel_at_period_end")} THEN ${val("cancel_at_period_end")}::boolean ELSE cancel_at_period_end END,
      stripe_customer_id = CASE WHEN ${has("stripe_customer_id")} THEN ${val("stripe_customer_id")}::text ELSE stripe_customer_id END,
      stripe_subscription_id = CASE WHEN ${has("stripe_subscription_id")} THEN ${val("stripe_subscription_id")}::text ELSE stripe_subscription_id END,
      price_id = CASE WHEN ${has("price_id")} THEN ${val("price_id")}::text ELSE price_id END,
      apple_original_transaction_id = CASE WHEN ${has("apple_original_transaction_id")} THEN ${val("apple_original_transaction_id")}::text ELSE apple_original_transaction_id END,
      apple_product_id = CASE WHEN ${has("apple_product_id")} THEN ${val("apple_product_id")}::text ELSE apple_product_id END
    WHERE user_id = ${existing.user_id}::uuid
  `;
  return { applied: true, userId: existing.user_id };
}

export type WebhookLedger = "stripe_webhook_events" | "apple_webhook_events";

/**
 * Insert-first idempotency: true = this delivery owns the event, false =
 * already handled (or being handled). Same contract as the Supabase insert
 * whose duplicate-key error meant "stop".
 */
export async function claimWebhookEvent(sql: Sql, ledger: WebhookLedger, eventId: string): Promise<boolean> {
  const rows = ledger === "stripe_webhook_events"
    ? await sql`INSERT INTO stripe_webhook_events (event_id) VALUES (${eventId}) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`
    : await sql`INSERT INTO apple_webhook_events (event_id) VALUES (${eventId}) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
  return rows.length > 0;
}

/** Handler failed → forget the event so the provider's retry runs it again. */
export async function releaseWebhookEvent(sql: Sql, ledger: WebhookLedger, eventId: string): Promise<void> {
  if (ledger === "stripe_webhook_events") {
    await sql`DELETE FROM stripe_webhook_events WHERE event_id = ${eventId}`;
  } else {
    await sql`DELETE FROM apple_webhook_events WHERE event_id = ${eventId}`;
  }
}

/**
 * `sync_log` on Neon is keyed by the planner `users.id`; billing knows the
 * auth id. Resolve it (null when the account has no planner row). Best
 * effort — a log line must never fail a payment write.
 */
export async function logBilling(
  sql: Sql,
  provider: "stripe" | "apple",
  operation: string,
  status: "ok" | "error",
  error?: string | null,
  authUserId?: string | null,
): Promise<void> {
  try {
    const owner = authUserId && UUID_RE.test(authUserId)
      ? ((await sql`
          SELECT id::text AS id FROM users WHERE auth_id = ${authUserId}::uuid OR id = ${authUserId}::uuid
          ORDER BY (auth_id = ${authUserId}::uuid) DESC NULLS LAST LIMIT 1
        `) as { id: string }[])[0]?.id ?? null
      : null;
    await sql`
      INSERT INTO sync_log (provider, operation, status, error, user_id)
      VALUES (${provider}, ${operation}, ${status}, ${error ?? null}, ${owner})
    `;
  } catch (e) {
    console.warn("billing: sync_log write failed", e instanceof Error ? e.name : "error");
  }
}

/** Sign-up trial — the Neon half of `handle_new_user`'s subscriptions insert. */
export async function ensureTrialSubscription(sql: Sql, authUserId: string): Promise<void> {
  await sql`
    INSERT INTO subscriptions (user_id, status, trial_ends_at)
    VALUES (${authUserId}::uuid, 'trialing', now() + interval '14 days')
    ON CONFLICT (user_id) DO NOTHING
  `;
}
