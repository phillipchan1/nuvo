/**
 * The in-app purchase confirm (`apple-iap`), decided once for both runtimes.
 *
 * The Supabase edge function (`supabase/functions/apple-iap`) and the Worker
 * route (`worker/src/billing/handlers.ts` `handleAppleIap`) both call
 * `confirmAppleTransaction` and only differ in how they read env, look up the
 * row that owns a lineage, and write the plan. Nothing a client sends about
 * the purchase is trusted: productId, expiry, bundle, environment, the ids,
 * appAccountToken and revocation all come from an App Store JWS that verified
 * against Apple Root CA - G3 (`verifyAppleJws`).
 *
 * Where the JWS comes from:
 *   · iOS 1.2+  — the device sends StoreKit 2's `jwsRepresentation`.
 *   · iOS 1.1   — the binary only knows ids. We ask Apple for the transaction
 *     by `transactionId` through the App Store Server API (production, then
 *     sandbox) and verify the returned `signedTransactionInfo` with the SAME
 *     verifier and rules. Without the API key configured the request is
 *     refused with a retriable 503 — client fields are never a fallback.
 *
 * Sandbox is accepted (App Review and TestFlight buy with sandbox receipts
 * against production) and recorded on the row as `apple_environment`.
 *
 * Imports only other `_shared` modules, so Deno, workerd and Node load it.
 */
import { verifyAppleJws, type AppleJwsOptions } from "./appleJws.ts";
import {
  fetchSignedTransactionInfo,
  isAppleTransactionId,
  type AppStoreApiCredentials,
} from "./appStoreServerApi.ts";
import { isOurIapProduct, type PlanWrite } from "./planRules.ts";

export type AppleEnvironment = "production" | "sandbox";

export interface VerifiedAppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  environment: AppleEnvironment;
  /** ISO instant, from the signed `expiresDate`. */
  expiresAt: string;
  /** Normalized lower-case UUID, or null when the purchase carried none (1.1). */
  appAccountToken: string | null;
}

/** Why a confirm was refused. `code` is safe to return and to log — never PII. */
export type AppleIapRejectCode =
  | "not_configured" // APPLE_BUNDLE_ID missing — fail closed
  | "verification_unavailable" // no JWS and no App Store Server API key — 1.1 client, fail closed
  | "apple_unreachable" // App Store Server API failed — retry
  | "missing_transaction" // neither a JWS nor a transaction id
  | "unverified" // JWS malformed / bad chain / wrong root / bad signature / not found at Apple
  | "wrong_bundle"
  | "unknown_product"
  | "bad_environment"
  | "revoked"
  | "expired"
  | "account_mismatch" // signed appAccountToken is another Nuvo user
  | "linked_elsewhere" // this lineage already entitles another Nuvo user
  | "active_on_other_rail"; // the account is paying on Stripe — a confirm never flips the rail

export interface AppleIapRejection {
  ok: false;
  status: 400 | 403 | 409 | 503;
  code: AppleIapRejectCode;
  retriable: boolean;
}

const STATUS: Record<AppleIapRejectCode, { status: AppleIapRejection["status"]; retriable: boolean }> = {
  not_configured: { status: 503, retriable: true },
  verification_unavailable: { status: 503, retriable: true },
  apple_unreachable: { status: 503, retriable: true },
  missing_transaction: { status: 400, retriable: false },
  unverified: { status: 400, retriable: false },
  wrong_bundle: { status: 400, retriable: false },
  unknown_product: { status: 400, retriable: false },
  bad_environment: { status: 400, retriable: false },
  revoked: { status: 400, retriable: false },
  expired: { status: 400, retriable: false },
  account_mismatch: { status: 403, retriable: false },
  linked_elsewhere: { status: 409, retriable: false },
  active_on_other_rail: { status: 409, retriable: false },
};

export function rejectIap(code: AppleIapRejectCode): AppleIapRejection {
  return { ok: false, code, ...STATUS[code] };
}

export type BillingRuntime = "supabase" | "worker";

/**
 * The one alertable line per refused confirm: single-line JSON, codes and
 * counts only — never an id, a token or a JWS. Alert on repeated
 * `apple_unreachable` (a missing / revoked APPLE_IAP_* key makes every 1.1
 * confirm one, forever — QA2 #136 S7).
 */
export function iapVerifyLogLine(r: AppleIapRejection, runtime: BillingRuntime): string {
  return JSON.stringify({ event: "apple_iap_verify", outcome: "rejected", code: r.code, status: r.status, runtime });
}

/** What the client sees. Generic on purpose — the code is enough to act on. */
export function iapRejectionBody(r: AppleIapRejection): { error: string; code: AppleIapRejectCode; retriable: boolean } {
  const error = r.retriable
    ? "Couldn’t verify the App Store purchase right now. Try again in a moment."
    : r.code === "linked_elsewhere"
      ? "This App Store subscription already belongs to another Nuvo account."
      : r.code === "active_on_other_rail"
        ? "This Nuvo account already has an active subscription billed on the web."
        : r.code === "account_mismatch"
          ? "This App Store purchase was made from another Nuvo account."
          : r.code === "expired" || r.code === "revoked"
            ? "That App Store subscription is no longer active."
            : "Couldn’t verify the App Store purchase.";
  return { error, code: r.code, retriable: r.retriable };
}

/**
 * StoreKit `appAccountToken` = the Nuvo user id, set at purchase. Hyphenated
 * or compact 32-hex, any case; anything else is null.
 */
export function parseAppAccountToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) return null;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  // Apple's ids are numeric strings; tolerate a number without trusting its shape.
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function sameUser(a: string, b: string): boolean {
  return (parseAppAccountToken(a) ?? a.toLowerCase()) === (parseAppAccountToken(b) ?? b.toLowerCase());
}

/**
 * Pure: is this VERIFIED transaction payload one we may entitle `userId` with?
 * (The lineage-ownership check needs the DB — see `ownershipRejection`.)
 */
export function evaluateAppleTransaction(
  payload: Record<string, unknown>,
  ctx: {
    userId: string;
    bundleId: string | null;
    iapEnv: { NUVO_IAP_MONTHLY?: string; NUVO_IAP_ANNUAL?: string };
    now?: Date;
  },
): { ok: true; tx: VerifiedAppleTransaction } | AppleIapRejection {
  if (!ctx.bundleId) return rejectIap("not_configured");
  const bundleId = str(payload.bundleId);
  if (bundleId !== ctx.bundleId) return rejectIap("wrong_bundle");

  const productId = str(payload.productId);
  if (!isOurIapProduct(productId, ctx.iapEnv)) return rejectIap("unknown_product");

  const transactionId = str(payload.transactionId);
  const originalTransactionId = str(payload.originalTransactionId);
  if (!transactionId || !originalTransactionId) return rejectIap("unverified");

  const env = str(payload.environment)?.toLowerCase();
  if (env !== "production" && env !== "sandbox") return rejectIap("bad_environment");

  if (payload.revocationDate !== undefined && payload.revocationDate !== null) return rejectIap("revoked");

  const expires = epochMs(payload.expiresDate);
  const now = (ctx.now ?? new Date()).getTime();
  if (expires === null || expires <= now) return rejectIap("expired");

  let appAccountToken: string | null = null;
  const rawToken = payload.appAccountToken;
  if (rawToken !== undefined && rawToken !== null && rawToken !== "") {
    appAccountToken = parseAppAccountToken(rawToken);
    if (!appAccountToken || !sameUser(appAccountToken, ctx.userId)) return rejectIap("account_mismatch");
  }

  return {
    ok: true,
    tx: {
      transactionId,
      originalTransactionId,
      productId: productId!,
      bundleId,
      environment: env,
      expiresAt: new Date(expires).toISOString(),
      appAccountToken,
    },
  };
}

/** A lineage already linked to a different account is never moved by a confirm. */
export function ownershipRejection(linkedUserId: string | null, userId: string): AppleIapRejection | null {
  if (linkedUserId && !sameUser(linkedUserId, userId)) return rejectIap("linked_elsewhere");
  return null;
}

/** The rail-relevant columns of a `subscriptions` row. */
export interface RailRow {
  apple_original_transaction_id?: string | null;
  status?: string | null;
  plan_source?: string | null;
  stripe_subscription_id?: string | null;
}

/**
 * Is this row paying (or in a trial) on Stripe? Then nothing Apple does may
 * flip it to `apple`: the lineage's later EXPIRED / REFUND would cancel a
 * live Stripe plan (QA2 #129 S2, #136 S2). A cancelled / past_due Stripe row
 * is not protected — a new App Store purchase may take it over.
 */
export function activeOnStripe(row: RailRow | null): boolean {
  if (!row || row.plan_source === "apple") return false;
  const stripe = row.plan_source === "stripe" || Boolean(row.stripe_subscription_id);
  return stripe && (row.status === "active" || row.status === "trialing");
}

/**
 * App Store webhook (Worker): may a signed `appAccountToken` attach a lineage
 * no row is linked to yet to the token's account? Only when that account has
 * no Apple purchase linked and isn't paying on another rail (`activeOnStripe`).
 * `null` = the account has no row yet (it is created only for a known user).
 */
export function appleTokenMayAttach(target: RailRow | null): boolean {
  if (!target) return true;
  if (target.apple_original_transaction_id) return false;
  return !activeOnStripe(target);
}

export interface AppleIapDeps {
  /** APPLE_BUNDLE_ID. Missing → every confirm is refused (fail closed). */
  bundleId: string | null;
  iapEnv: { NUVO_IAP_MONTHLY?: string; NUVO_IAP_ANNUAL?: string };
  /** App Store Server API key, for 1.1 clients with no JWS. Null → those are refused. */
  apiCredentials: AppStoreApiCredentials | null;
  /** Tests only: pin a generated root. */
  jwsOptions?: AppleJwsOptions;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: Date;
  /** The `subscriptions.user_id` already linked to this lineage, or null. Throws on a DB error. */
  ownerOfOriginalTransaction: (originalTransactionId: string) => Promise<string | null>;
  /** The confirming account's own row (rail columns), or null. Throws on a DB error. */
  railRowOf: (userId: string) => Promise<RailRow | null>;
}

export type AppleIapConfirm =
  | { ok: true; tx: VerifiedAppleTransaction; source: "jws" | "server_api"; write: PlanWrite & { userId: string } }
  | AppleIapRejection;

/**
 * Verify a confirm request and return the plan write, or why not.
 * Reads ONLY `body.jwsRepresentation` (1.2+) or `body.transactionId` (1.1).
 * Every other body field is ignored. Never throws for a verification problem —
 * only `ownerOfOriginalTransaction` / `railRowOf` may throw (DB), which callers turn into a
 * generic 500 with no write.
 */
export async function confirmAppleTransaction(
  body: unknown,
  userId: string,
  deps: AppleIapDeps,
): Promise<AppleIapConfirm> {
  if (!deps.bundleId) return rejectIap("not_configured");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  let signed: string;
  let source: "jws" | "server_api";
  let askedFor: string | null = null;
  const jws = typeof b.jwsRepresentation === "string" ? b.jwsRepresentation.trim() : "";
  if (jws) {
    signed = jws;
    source = "jws";
  } else {
    const transactionId = str(b.transactionId);
    if (!transactionId) return rejectIap("missing_transaction");
    if (!deps.apiCredentials) return rejectIap("verification_unavailable");
    if (!isAppleTransactionId(transactionId)) return rejectIap("unverified");
    try {
      const got = await fetchSignedTransactionInfo(
        transactionId,
        deps.apiCredentials,
        deps.bundleId,
        deps.fetchImpl,
        deps.now ? Math.floor(deps.now.getTime() / 1000) : undefined,
      );
      if (got.kind === "not_found") return rejectIap("unverified");
      signed = got.signedTransactionInfo;
    } catch {
      // Network, auth, 429/5xx, a malformed answer — never fall back to the body.
      return rejectIap("apple_unreachable");
    }
    source = "server_api";
    askedFor = transactionId;
  }

  let payload: Record<string, unknown>;
  try {
    payload = await verifyAppleJws(signed, deps.jwsOptions);
  } catch {
    // Malformed, wrong root, bad chain, outside validity, bad signature.
    return rejectIap("unverified");
  }
  if (askedFor !== null && str(payload.transactionId) !== askedFor) return rejectIap("unverified");

  const verdict = evaluateAppleTransaction(payload, {
    userId,
    bundleId: deps.bundleId,
    iapEnv: deps.iapEnv,
    now: deps.now,
  });
  if (!verdict.ok) return verdict;
  const { tx } = verdict;

  const owner = await deps.ownerOfOriginalTransaction(tx.originalTransactionId);
  const conflict = ownershipRejection(owner, userId);
  if (conflict) return conflict;
  // A confirm never flips a Stripe-paying account to Apple — sandbox or not.
  if (activeOnStripe(await deps.railRowOf(userId))) return rejectIap("active_on_other_rail");

  return {
    ok: true,
    tx,
    source,
    write: {
      userId,
      plan: "active",
      planSource: "apple",
      currentPeriodEnd: tx.expiresAt,
      // Renewal state isn't in the transaction; App Store notifications own it.
      cancelAtPeriodEnd: false,
      appleOriginalTransactionId: tx.originalTransactionId,
      appleProductId: tx.productId,
      appleEnvironment: tx.environment,
    },
  };
}
