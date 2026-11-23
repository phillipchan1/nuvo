/**
 * Delete-account Stripe gate. Own read from Neon — never `readEntitlement`,
 * never a Stripe secret, never the Stripe API.
 *
 * The shared entitlement SELECT omits Stripe identifiers (they must not
 * leak to the client). This reader selects `stripe_subscription_id`
 * server-side only and collapses it to `hasStripeSubscription`.
 * `stripe_customer_id` is not a gate — a customer without a subscription
 * does not block.
 *
 * Refuse when the row is a Stripe subscription (plan_source = stripe, or
 * stripe_subscription_id present) AND status is active / past_due / unpaid
 * / trialing, even if plan_source is now apple. Period end and card-on-file
 * do not matter. Unknown stripe status fails closed. Trials with no Stripe
 * subscription, ended Stripe rows, and StoreKit-only users can delete.
 * A missing store, a failed query, or a row for someone else fail closed
 * here only; the shared entitlement reader is unchanged.
 */
import {
  APPLE_DELETE_NOTICE,
  STRIPE_DELETE_BLOCK_MESSAGE,
} from "../../../supabase/functions/_shared/accountDeletion.ts";
import { cutoverFlipped } from "../cutoverFlip.ts";
import type { Sql } from "../db.ts";
import type { Env } from "../env.ts";

export { APPLE_DELETE_NOTICE };

export type DeleteGateRow = {
  status?: string | null;
  plan?: string | null;
  plan_source?: string | null;
  planSource?: string | null;
  trial_ends_at?: string | null;
  entitled?: boolean;
  present?: boolean;
  /** Server-side only. Never sent to the client. True when stripe_subscription_id is set. */
  hasStripeSubscription?: boolean;
};

export const ACTIVE_STRIPE_DELETE_MESSAGE = STRIPE_DELETE_BLOCK_MESSAGE;

/** Physical CHECK on public.subscriptions.status (00000000000041_billing.sql). */
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;

const STRIPE_ENDED = new Set(["cancelled", "canceled", "incomplete_expired"]);
const STRIPE_CHARGING = new Set(["active", "past_due", "unpaid", "trialing"]);

export function billingPlanSource(row: DeleteGateRow | null | undefined): string {
  if (!row) return "";
  return (row.plan_source ?? row.planSource ?? "").toString().trim().toLowerCase();
}

function chargingStatus(row: DeleteGateRow): string {
  return (row.status ?? row.plan ?? "").toString().trim().toLowerCase();
}

/** A Stripe subscription exists on this row (source or leftover sub id). */
export function isStripeSubscriptionRow(row: DeleteGateRow | null | undefined): boolean {
  if (!row) return false;
  return billingPlanSource(row) === "stripe" || row.hasStripeSubscription === true;
}

/** Refuse wipe for a charging Stripe subscription. Customer id is not a gate. */
export function stripeSubscriptionBlocksDelete(row: DeleteGateRow | null | undefined): boolean {
  if (!row) return false;
  if ("present" in row && row.present === false) return false;
  if (!isStripeSubscriptionRow(row)) return false;
  const status = chargingStatus(row);
  if (!status) return true;
  if (STRIPE_ENDED.has(status)) return false;
  if (STRIPE_CHARGING.has(status)) return true;
  return true;
}

export class BillingLookupError extends Error {
  override name = "BillingLookupError";
  constructor() {
    super("billing lookup failed");
  }
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapGateRow(value: unknown, userId: string): DeleteGateRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BillingLookupError();
  }
  const raw = value as Record<string, unknown>;
  const owner = asText(raw.user_id);
  if (!owner || owner !== userId) throw new BillingLookupError();
  const source = asText(raw.plan_source).toLowerCase();
  return {
    status: asText(raw.status) || null,
    plan_source: source === "stripe" || source === "apple" ? source : null,
    trial_ends_at: asText(raw.trial_ends_at) || null,
    present: true,
    hasStripeSubscription: Boolean(asText(raw.stripe_subscription_id)),
  };
}

export type BillingReader = (
  env: Pick<Env, "CUTOVER_FLIPPED">,
  userId: string,
) => Promise<DeleteGateRow | null>;

let testReader: BillingReader | null = null;

export function installBillingReaderForTests(fn: BillingReader): () => void {
  testReader = fn;
  return () => {
    testReader = null;
  };
}

/** Post-flip delete gate: the same columns from Neon. Any failure fails closed. */
export async function readBillingSubscriptionFromNeon(sql: Sql, userId: string): Promise<DeleteGateRow | null> {
  let rows: unknown[];
  try {
    rows = (await sql`
      SELECT user_id::text AS user_id, status, trial_ends_at::text AS trial_ends_at, plan_source, stripe_subscription_id
      FROM subscriptions WHERE user_id = ${userId}::uuid LIMIT 1
    `) as unknown as unknown[];
  } catch {
    throw new BillingLookupError();
  }
  if (!rows.length) return null;
  return mapGateRow(rows[0], userId);
}

export async function readBillingSubscription(
  env: Pick<Env, "CUTOVER_FLIPPED">,
  userId: string,
  sql?: Sql,
): Promise<DeleteGateRow | null> {
  if (testReader) return testReader(env, userId);
  if (sql && cutoverFlipped(env.CUTOVER_FLIPPED)) return readBillingSubscriptionFromNeon(sql, userId);
  throw new BillingLookupError();
}
