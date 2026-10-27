/**
 * Dual-path subscription / entitlement read.
 *
 * Flag off (`VITE_API_BASE_URL` empty) → today's PostgREST `subscriptions`
 * select. Flag on → `GET /api/entitlement` with the Better Auth session.
 * Both answers go through `isEntitled` / `interpretSubscriptionRead` /
 * `resolveEntitlementView` so the shell's loading / verify-error / locked /
 * open states stay one function.
 *
 * Read-only. Payment-rail writers stay on Supabase and are not imported here.
 */
import { entitlementUrl } from "./backend";
import {
  interpretSubscriptionRead,
  type Subscription,
  type SubscriptionStatus,
} from "./subscription";
import type { PlanSource } from "../../supabase/functions/_shared/planRules.ts";

export const ENTITLEMENT_TIMEOUT_MS = 8_000;
export const VERIFY_ERROR = "Couldn't verify your subscription";

/** Better Auth session changed (sign-in / sign-out / bearer persist). */
export const AUTH_SESSION_CHANGED = "nuvo-ba-session";

export interface WorkerEntitlementBody {
  entitled?: unknown;
  present?: unknown;
  plan?: unknown;
  plan_source?: unknown;
  status?: unknown;
  trial_ends_at?: unknown;
  current_period_end?: unknown;
  cancel_at_period_end?: unknown;
  referral_code?: unknown;
  referral_uses?: unknown;
  referral_last_use_at?: unknown;
  referral_credits_earned?: unknown;
  referral_last_credit_at?: unknown;
}

const PLAN_STATES: ReadonlySet<string> = new Set([
  "trialing",
  "active",
  "cancelled",
  "past_due",
]);

function asPlanState(value: unknown): SubscriptionStatus | null {
  return typeof value === "string" && PLAN_STATES.has(value)
    ? (value as SubscriptionStatus)
    : null;
}

function asPlanSource(value: unknown): PlanSource | null {
  return value === "stripe" || value === "apple" ? value : null;
}

/**
 * Map a Worker entitlement JSON body onto the Subscription shape the shell
 * already reads. `present: false` is a real empty answer (service-role
 * lookup, not RLS) — same as PostgREST `null`. Stripe / Apple identifiers
 * stay null; period, cancel, and referral display fields come through so
 * Settings → Billing can say "Ends …" / "Resume subscription".
 */
export function subscriptionFromWorkerBody(
  body: WorkerEntitlementBody,
): Subscription | null {
  if (body.present !== true) return null;
  const status = asPlanState(body.status) ?? asPlanState(body.plan);
  if (!status) return null;
  const trial = typeof body.trial_ends_at === "string" ? body.trial_ends_at : "";
  const period = typeof body.current_period_end === "string" ? body.current_period_end : null;
  const code = typeof body.referral_code === "string" ? body.referral_code : null;
  const uses = typeof body.referral_uses === "number" && Number.isFinite(body.referral_uses)
    ? Math.max(0, Math.floor(body.referral_uses))
    : 0;
  const credits = typeof body.referral_credits_earned === "number" && Number.isFinite(body.referral_credits_earned)
    ? Math.max(0, Math.floor(body.referral_credits_earned))
    : 0;
  return {
    user_id: "",
    status,
    plan: asPlanState(body.plan) ?? status,
    plan_source: asPlanSource(body.plan_source),
    trial_ends_at: trial,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    price_id: null,
    current_period_end: period,
    cancel_at_period_end: body.cancel_at_period_end === true,
    referral_code: code,
    referral_uses: uses,
    referral_last_use_at: typeof body.referral_last_use_at === "string" ? body.referral_last_use_at : null,
    referral_credits_earned: credits,
    referral_last_credit_at: typeof body.referral_last_credit_at === "string" ? body.referral_last_credit_at : null,
    entitled: body.entitled === true,
  };
}

export type WorkerEntitlementVerdict =
  | { action: "return"; row: Subscription | null }
  | { action: "fail"; reason: string };

/**
 * HTTP → the same return / fail split the PostgREST path uses. A 503, a
 * 401 with a live client session, or a malformed 200 is a verify-error —
 * never "not entitled". Only a well-formed 200 unlocks or locks.
 */
export function interpretWorkerEntitlementHttp(
  status: number,
  body: unknown,
): WorkerEntitlementVerdict {
  if (status === 200 && body && typeof body === "object" && !Array.isArray(body)) {
    const rec = body as WorkerEntitlementBody;
    if (rec.present === false) return { action: "return", row: null };
    if (rec.present === true) {
      const row = subscriptionFromWorkerBody(rec);
      if (!row) return { action: "fail", reason: "invalid entitlement body" };
      return { action: "return", row };
    }
    return { action: "fail", reason: "invalid entitlement body" };
  }
  if (status === 401) return { action: "fail", reason: "unauthorized" };
  return { action: "fail", reason: `entitlement ${status || "error"}` };
}

export async function fetchWorkerEntitlement(opts: {
  url?: string;
  token: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<Subscription | null> {
  const url = opts.url ?? entitlementUrl();
  if (!url) throw new Error(VERIFY_ERROR);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers,
      credentials: "include",
      signal: AbortSignal.timeout(opts.timeoutMs ?? ENTITLEMENT_TIMEOUT_MS),
    });
  } catch {
    throw new Error(VERIFY_ERROR);
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const verdict = interpretWorkerEntitlementHttp(res.status, parsed);
  if (verdict.action === "fail") throw new Error(VERIFY_ERROR);
  return verdict.row;
}

type PostgrestClient = {
  from: (table: string) => {
    select: (columns: string) => {
      abortSignal: (signal: AbortSignal) => {
        // supabase-js returns a thenable builder, not a native Promise.
        maybeSingle: () => PromiseLike<{
          data: Subscription | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  auth: {
    getSession: () => PromiseLike<{ data: { session: { access_token?: string } | null } }>;
    refreshSession: () => PromiseLike<unknown>;
  };
};

/**
 * Today's PostgREST path. `*` only — never the computed `entitled` / `plan`
 * aliases (they 400 the whole select when the SQL functions are missing).
 */
export async function fetchPostgrestSubscription(
  client: PostgrestClient,
  opts: { alreadyRetried?: boolean; skipRefresh?: boolean } = {},
): Promise<Subscription | null> {
  const { data, error } = await client
    .from("subscriptions")
    .select("*")
    .abortSignal(AbortSignal.timeout(ENTITLEMENT_TIMEOUT_MS))
    .maybeSingle();
  if (error) throw error;
  const { data: sessionData } = await client.auth.getSession();
  const verdict = interpretSubscriptionRead(data, {
    hasSession: Boolean(sessionData.session),
    alreadyRetried: Boolean(opts.alreadyRetried),
  });
  if (verdict.action === "return") return verdict.row;
  if (verdict.action === "fail") throw new Error(VERIFY_ERROR);
  if (opts.skipRefresh) return data;
  console.warn("[nuvo] subscription read null with a live session — refreshing and retrying");
  await client.auth.refreshSession();
  return fetchPostgrestSubscription(client, { alreadyRetried: true, skipRefresh: opts.skipRefresh });
}

/** The only switch: Worker flag on → Worker GET; otherwise PostgREST. */
export async function readSubscription(opts: {
  workersEnabled: boolean;
  token?: string | null;
  url?: string;
  fetchImpl?: typeof fetch;
  postgrest?: PostgrestClient;
  skipRefresh?: boolean;
}): Promise<Subscription | null> {
  if (opts.workersEnabled) {
    return fetchWorkerEntitlement({
      url: opts.url,
      token: opts.token ?? null,
      fetchImpl: opts.fetchImpl,
    });
  }
  if (!opts.postgrest) throw new Error(VERIFY_ERROR);
  return fetchPostgrestSubscription(opts.postgrest, { skipRefresh: opts.skipRefresh });
}
