/**
 * Worker entitlement check. Billing rows stay on Supabase; this module
 * only SELECTs `subscriptions` by the session's preserved user id
 * (Better Auth `user.id` = GoTrue `auth.users.id` after the auth copy).
 *
 * Never looks up by email, a remapped planner id, or a client-supplied
 * user_id. Payment-rail writers are not imported here.
 */
import { isEntitled, planOf, type PlanSource, type PlanState } from "../../supabase/functions/_shared/planRules.ts";
import { cutoverFlipped } from "./cutoverFlip.ts";
import type { Sql } from "./db.ts";

export type { PlanSource, PlanState };

export interface EntitlementEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** After the flip, billing lives on Neon (worker/src/billing) and is read there. */
  CUTOVER_FLIPPED?: string;
}

/** Physical columns only — never the `entitled` / `plan` SQL functions,
 *  and never Stripe / Apple identifiers. */
export interface SubscriptionColumns {
  user_id: string;
  status: PlanState | null;
  trial_ends_at: string | null;
  plan_source: PlanSource | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  /** `production` | `sandbox` — a sandbox Apple row is entitled only until current_period_end. */
  apple_environment?: "production" | "sandbox" | null;
  referral_code?: string | null;
  referral_uses?: number;
  referral_last_use_at?: string | null;
  referral_credits_earned?: number;
  referral_last_credit_at?: string | null;
}

export interface Entitlement {
  userId: string;
  present: boolean;
  entitled: boolean;
  plan: PlanState | null;
  planSource: PlanSource | null;
  status: PlanState | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  appleEnvironment: "production" | "sandbox" | null;
  referralCode: string | null;
  referralUses: number;
  referralLastUseAt: string | null;
  referralCreditsEarned: number;
  referralLastCreditAt: string | null;
}

export class EntitlementUnavailableError extends Error {
  override name = "EntitlementUnavailableError";
  constructor(cause?: unknown) {
    super("entitlement unavailable");
    this.cause = cause;
  }
}

export type SubscriptionFetcher = (
  env: EntitlementEnv,
  userId: string,
) => Promise<SubscriptionColumns | null>;

const PHYSICAL_SELECT = [
  "user_id",
  "status",
  "trial_ends_at",
  "plan_source",
  "current_period_end",
  "cancel_at_period_end",
  "apple_environment",
  "referral_code",
  "referral_uses",
  "referral_last_use_at",
  "referral_credits_earned",
  "referral_last_credit_at",
].join(",");

/** PostgREST URL: filter is only `user_id=eq.<session id>`. */
export function subscriptionQueryUrl(baseUrl: string, userId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("user_id", `eq.${userId}`);
  params.set("select", PHYSICAL_SELECT);
  return `${base}/rest/v1/subscriptions?${params.toString()}`;
}

function asIso(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function entitlementOf(
  row: SubscriptionColumns | null | undefined,
  userId: string,
  now: Date = new Date(),
): Entitlement {
  const plan = planOf(row ?? null);
  return {
    userId,
    present: Boolean(row),
    entitled: isEntitled(row ?? null, now),
    plan,
    planSource: row?.plan_source ?? null,
    status: row?.status ?? plan,
    trialEndsAt: row?.trial_ends_at ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end === true,
    appleEnvironment: row?.apple_environment ?? null,
    referralCode: row?.referral_code ?? null,
    referralUses: row?.referral_uses ?? 0,
    referralLastUseAt: row?.referral_last_use_at ?? null,
    referralCreditsEarned: row?.referral_credits_earned ?? 0,
    referralLastCreditAt: row?.referral_last_credit_at ?? null,
  };
}

function parseSubscriptionRow(value: unknown): SubscriptionColumns | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  if (!userId) return null;
  const status = typeof row.status === "string" ? (row.status as PlanState) : null;
  const source = row.plan_source;
  return {
    user_id: userId,
    status,
    trial_ends_at: asIso(row.trial_ends_at),
    plan_source: source === "stripe" || source === "apple" ? source : null,
    current_period_end: asIso(row.current_period_end),
    cancel_at_period_end: row.cancel_at_period_end === true,
    apple_environment: row.apple_environment === "production" || row.apple_environment === "sandbox" ? row.apple_environment : null,
    referral_code: asIso(row.referral_code),
    referral_uses: asCount(row.referral_uses),
    referral_last_use_at: asIso(row.referral_last_use_at),
    referral_credits_earned: asCount(row.referral_credits_earned),
    referral_last_credit_at: asIso(row.referral_last_credit_at),
  };
}

export async function fetchSubscriptionByUserId(
  env: EntitlementEnv,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscriptionColumns | null> {
  const base = env.SUPABASE_URL?.trim() ?? "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!base || !key) {
    throw new EntitlementUnavailableError("supabase is not configured");
  }
  let res: Response;
  try {
    res = await fetchImpl(subscriptionQueryUrl(base, userId), {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new EntitlementUnavailableError(err);
  }
  if (res.status === 406 || res.status === 404) return null;
  if (!res.ok) throw new EntitlementUnavailableError(`supabase ${res.status}`);
  const body: unknown = await res.json().catch(() => null);
  if (Array.isArray(body)) {
    const first = body[0];
    const row = parseSubscriptionRow(first);
    if (row && row.user_id !== userId) return null;
    return row;
  }
  const row = parseSubscriptionRow(body);
  if (row && row.user_id !== userId) return null;
  return row;
}

/**
 * Post-flip read: the same physical columns, from Neon, by the same
 * preserved user id. Billing writes land here once CUTOVER_FLIPPED.
 */
export async function fetchSubscriptionFromNeon(sql: Sql, userId: string): Promise<SubscriptionColumns | null> {
  let rows: unknown[];
  try {
    rows = (await sql`
      SELECT user_id::text AS user_id, status,
             to_char(trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_ends_at,
             plan_source,
             to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_end,
             cancel_at_period_end, apple_environment, referral_code, referral_uses,
             to_char(referral_last_use_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS referral_last_use_at,
             referral_credits_earned,
             to_char(referral_last_credit_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS referral_last_credit_at
      FROM subscriptions
      WHERE user_id = ${userId}::uuid
      LIMIT 1
    `) as unknown as unknown[];
  } catch (err) {
    throw new EntitlementUnavailableError(err);
  }
  const row = parseSubscriptionRow(rows[0]);
  if (row && row.user_id !== userId) return null;
  return row;
}

let fetchSubscription: SubscriptionFetcher = fetchSubscriptionByUserId;
let fetcherOverridden = false;

export function installSubscriptionFetcherForTests(fn: SubscriptionFetcher): () => void {
  fetchSubscription = fn;
  fetcherOverridden = true;
  return () => {
    fetchSubscription = fetchSubscriptionByUserId;
    fetcherOverridden = false;
  };
}

/**
 * THE Worker entitlement check. `userId` is the verified session id
 * (preserved from the auth copy). Callers must not pass a client id.
 */
export async function readEntitlement(
  env: EntitlementEnv,
  userId: string,
  now: Date = new Date(),
  sql?: Sql,
): Promise<Entitlement> {
  const onNeon = Boolean(sql) && cutoverFlipped(env.CUTOVER_FLIPPED) && !fetcherOverridden;
  const row = onNeon ? await fetchSubscriptionFromNeon(sql!, userId) : await fetchSubscription(env, userId);
  if (row && row.user_id !== userId) {
    return entitlementOf(null, userId, now);
  }
  return entitlementOf(row, userId, now);
}

export function entitlementResponseBody(entitlement: Entitlement): Record<string, unknown> {
  return {
    entitled: entitlement.entitled,
    present: entitlement.present,
    plan: entitlement.plan,
    plan_source: entitlement.planSource,
    status: entitlement.status,
    trial_ends_at: entitlement.trialEndsAt,
    current_period_end: entitlement.currentPeriodEnd,
    cancel_at_period_end: entitlement.cancelAtPeriodEnd,
    apple_environment: entitlement.appleEnvironment,
    referral_code: entitlement.referralCode,
    referral_uses: entitlement.referralUses,
    referral_last_use_at: entitlement.referralLastUseAt,
    referral_credits_earned: entitlement.referralCreditsEarned,
    referral_last_credit_at: entitlement.referralLastCreditAt,
  };
}
