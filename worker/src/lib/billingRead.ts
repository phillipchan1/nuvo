/**
 * Delete-account Stripe gate. Own PostgREST read — never `readEntitlement`,
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
 * 404/406 and a 200 that is not a documented empty `[]` fail closed here
 * only; the shared entitlement reader is unchanged.
 */
import {
  APPLE_DELETE_NOTICE,
  STRIPE_DELETE_BLOCK_MESSAGE,
} from "../../../supabase/functions/_shared/accountDeletion.ts";
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

const GATE_SELECT = [
  "user_id",
  "status",
  "trial_ends_at",
  "plan_source",
  "stripe_subscription_id",
].join(",");

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

/** PostgREST URL for the delete gate only — includes Stripe id columns. */
export function billingSubscriptionQueryUrl(baseUrl: string, userId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("user_id", `eq.${userId}`);
  params.set("select", GATE_SELECT);
  return `${base}/rest/v1/subscriptions?${params.toString()}`;
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
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
  fetchImpl?: typeof fetch,
) => Promise<DeleteGateRow | null>;

let testReader: BillingReader | null = null;

export function installBillingReaderForTests(fn: BillingReader): () => void {
  testReader = fn;
  return () => {
    testReader = null;
  };
}

async function fetchBillingSubscription(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
  fetchImpl: typeof fetch,
): Promise<DeleteGateRow | null> {
  const base = env.SUPABASE_URL?.trim() ?? "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!base || !key) throw new BillingLookupError();
  let res: Response;
  try {
    res = await fetchImpl(billingSubscriptionQueryUrl(base, userId), {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new BillingLookupError();
  }
  // 404/406 is not the empty-row document (that's HTTP 200 + `[]`).
  // A missing table or schema-cache miss must fail closed — here only.
  if (res.status === 406 || res.status === 404) throw new BillingLookupError();
  if (!res.ok) throw new BillingLookupError();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new BillingLookupError();
  }
  if (body == null) throw new BillingLookupError();
  if (Array.isArray(body)) {
    if (body.length === 0) return null;
    return mapGateRow(body[0], userId);
  }
  return mapGateRow(body, userId);
}

export async function readBillingSubscription(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
  fetchImpl?: typeof fetch,
): Promise<DeleteGateRow | null> {
  if (testReader && !fetchImpl) return testReader(env, userId);
  return fetchBillingSubscription(env, userId, fetchImpl ?? fetch);
}
