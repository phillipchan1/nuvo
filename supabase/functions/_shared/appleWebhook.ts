/**
 * App Store Server Notifications V2 — the Supabase `apple-webhook`, decided
 * in one pure, runtime-neutral place (Deno, workerd and Node all load it;
 * `tests/apple-webhook-verify.test.ts` drives it end to end).
 *
 * Nothing in a notification is trusted until it verified against Apple Root
 * CA - G3 (`verifyAppleJws`): the outer `signedPayload`, the nested
 * `data.signedTransactionInfo` and, when present, `data.signedRenewalInfo`.
 * Plan, expiry, product, environment and the lineage id are re-derived from
 * those verified payloads only.
 *
 * Status codes (Apple retries any non-2xx, for ~3 days):
 *   · 401 — APPLE_NOTIFICATION_SECRET is set and the URL's `secret` is wrong.
 *   · 503 `not_configured` — APPLE_BUNDLE_ID unset. Fail closed, but
 *     retriable, so the notifications are processed once the secret is set
 *     instead of being acked into the void.
 *   · 400 — no/malformed/unsigned JWS, bad chain, wrong root, bad signature
 *     (outer OR nested), environment missing/unknown or disagreeing between
 *     the envelope and the transaction, renewal info for another lineage.
 *   · 400 `wrong_bundle` — a VERIFIED notification for another bundle. Not a
 *     2xx "ignored": a mistyped APPLE_BUNDLE_ID (it must be the iOS id,
 *     `day.nuvo.app` — `com.nuvo.app` is the macOS app, which makes no App
 *     Store purchases) must be loud and leave Apple retrying while it is
 *     fixed, rather than ack every real renewal with no write. A genuinely
 *     foreign bundle only costs Apple a few retries.
 *   Every refusal answers a fixed body (`{ error: "rejected" }`, or
 *   `"unavailable"` for the 503) — the code is logged, never returned.
 *   · 200 `ignored` — verified, ours, but nothing to write: an unmapped type
 *     (TEST, CONSUMPTION_REQUEST, …), no transaction, a product outside the
 *     catalog. No ledger claim either — there is nothing to make idempotent.
 *   · 200 `duplicate` — the notificationUUID was already claimed.
 *   · 500 `{ error: "handler failed" }` — any DB error, or the row changed
 *     between the read and the write. The claim rolls back with the write
 *     (one transaction, `apple_webhook_apply`), so Apple's retry runs it again.
 *
 * The Worker (`worker/src/billing/handlers.ts`) runs the SAME decision
 * (`decideAppleNotification`) and differs only in the write: it may attach an
 * unlinked lineage to the verified `appAccountToken`'s account
 * (`appleTokenMayAttach`), inside its own `sql.begin`. This function matches
 * the row by `originalTransactionId` ONLY (never attaches by token, never
 * moves a lineage between users).
 *
 * Imports only other `_shared` modules.
 */
import { verifyAppleJws, type AppleJwsOptions } from "./appleJws.ts";
import { parseAppAccountToken, type AppleEnvironment, type BillingRuntime } from "./appleIap.ts";
import {
  appleNotificationToPlan,
  isOurIapProduct,
  planOf,
  planRowPatch,
  type PlanSource,
  type PlanState,
  type PlanWrite,
} from "./planRules.ts";

/** Safe to return and to log — never PII, never an id. */
export type AppleWebhookRejectCode =
  | "not_configured"
  | "missing_payload"
  | "unverified"
  | "unverified_transaction"
  | "unverified_renewal"
  | "wrong_bundle"
  | "bad_environment"
  | "environment_mismatch"
  | "lineage_mismatch";

export type AppleWebhookIgnoreCode = "unhandled_type" | "no_data" | "no_transaction" | "unknown_product";

export type AppleWebhookDecision =
  | { kind: "reject"; status: 400 | 503; code: AppleWebhookRejectCode }
  | { kind: "ignore"; code: AppleWebhookIgnoreCode; notificationType: string }
  | {
      kind: "apply";
      notificationUUID: string;
      notificationType: string;
      originalTransactionId: string;
      environment: AppleEnvironment;
      /** The VERIFIED transaction's appAccountToken, normalized, or null. Only the Worker reads it. */
      appAccountToken: string | null;
      write: PlanWrite & { appleOriginalTransactionId: string; appleEnvironment: AppleEnvironment };
    };

export interface AppleWebhookConfig {
  /** APPLE_BUNDLE_ID (`day.nuvo.app`). Null → every notification is a 503. */
  bundleId: string | null;
  iapEnv: { NUVO_IAP_MONTHLY?: string; NUVO_IAP_ANNUAL?: string };
  /** Tests only: pin a generated root. */
  jwsOptions?: AppleJwsOptions;
}

type Obj = Record<string, unknown>;

function reject(code: AppleWebhookRejectCode): AppleWebhookDecision {
  return { kind: "reject", status: code === "not_configured" ? 503 : 400, code };
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  // Apple's ids are numeric strings; tolerate a number without trusting its shape.
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function obj(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}

function epochIso(value: unknown): string | null {
  const n = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function environmentOf(value: unknown): AppleEnvironment | null {
  const env = str(value)?.toLowerCase();
  return env === "production" || env === "sandbox" ? env : null;
}

async function verified(jws: string, opts: AppleJwsOptions | undefined): Promise<Obj | null> {
  try {
    return await verifyAppleJws(jws, opts);
  } catch {
    // Malformed, unsigned, wrong root, bad chain, outside validity, bad signature.
    return null;
  }
}

/**
 * Verify a notification body and decide what (if anything) to write. Reads
 * ONLY `body.signedPayload`. Never throws, never touches the DB.
 */
export async function decideAppleNotification(body: unknown, cfg: AppleWebhookConfig): Promise<AppleWebhookDecision> {
  if (!cfg.bundleId) return reject("not_configured");
  const signedPayload = str(obj(body)?.signedPayload);
  if (!signedPayload) return reject("missing_payload");

  const notification = await verified(signedPayload, cfg.jwsOptions);
  if (!notification) return reject("unverified");

  const notificationType = str(notification.notificationType) ?? "";
  const notificationUUID = str(notification.notificationUUID);
  // Apple always signs one in; without it the write can't be made idempotent.
  if (!notificationUUID) return reject("unverified");

  // Summary notifications (RENEWAL_EXTENSION) carry `summary`, not `data`.
  const data = obj(notification.data);
  const envelope = data ?? obj(notification.summary);
  if (!envelope) return { kind: "ignore", code: "no_data", notificationType };
  if (str(envelope.bundleId) !== cfg.bundleId) return reject("wrong_bundle");
  const environment = environmentOf(envelope.environment);
  if (!environment) return reject("bad_environment");

  const mapped = appleNotificationToPlan(notificationType, str(notification.subtype));
  if (!mapped) return { kind: "ignore", code: "unhandled_type", notificationType };

  const signedTx = str(data?.signedTransactionInfo);
  if (!signedTx) return { kind: "ignore", code: "no_transaction", notificationType };
  const tx = await verified(signedTx, cfg.jwsOptions);
  if (!tx) return reject("unverified_transaction");

  const signedRenewal = str(data?.signedRenewalInfo);
  const renewal = signedRenewal ? await verified(signedRenewal, cfg.jwsOptions) : null;
  if (signedRenewal && !renewal) return reject("unverified_renewal");

  if (str(tx.bundleId) !== cfg.bundleId) return reject("wrong_bundle");
  const txEnvironment = environmentOf(tx.environment);
  if (!txEnvironment) return reject("bad_environment");
  if (txEnvironment !== environment) return reject("environment_mismatch");

  const originalTransactionId = str(tx.originalTransactionId);
  if (!originalTransactionId) return reject("unverified_transaction");

  if (renewal) {
    const renewalOtx = str(renewal.originalTransactionId);
    if (renewalOtx && renewalOtx !== originalTransactionId) return reject("lineage_mismatch");
    if (renewal.environment !== undefined && environmentOf(renewal.environment) !== environment) {
      return reject("environment_mismatch");
    }
  }

  const productId = str(tx.productId);
  if (!isOurIapProduct(productId, cfg.iapEnv)) return { kind: "ignore", code: "unknown_product", notificationType };

  // Same mapping as the Worker. A revoked transaction (refund, Family Sharing
  // removal) is never `active`, whatever the notification type says.
  const revoked = tx.revocationDate !== undefined && tx.revocationDate !== null;
  const plan: PlanState = revoked && mapped.plan === "active" ? "cancelled" : mapped.plan;
  const currentPeriodEnd = epochIso(tx.expiresDate);

  return {
    kind: "apply",
    notificationUUID,
    notificationType,
    originalTransactionId,
    environment,
    appAccountToken: parseAppAccountToken(tx.appAccountToken),
    write: {
      plan,
      planSource: "apple",
      // Expiry is the verified transaction's — a missing one leaves the column alone.
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      cancelAtPeriodEnd: plan === "active" ? mapped.cancelAtPeriodEnd : false,
      appleOriginalTransactionId: originalTransactionId,
      appleProductId: productId,
      appleEnvironment: environment,
    },
  };
}

// ── the write ────────────────────────────────────────────────────────────────

/** The row a lineage is linked to, as read before the write. */
export interface AppleLinkedRow {
  user_id: string;
  status: PlanState;
  plan_source: PlanSource | null;
}

/** Arguments of `public.apple_webhook_apply` (migration 00000000000092). */
export interface AppleWebhookApplyArgs {
  p_event_id: string;
  p_original_transaction_id: string;
  /** The row read before the write, or null when no row holds the lineage. */
  p_expected_user_id: string | null;
  p_expected_status: string | null;
  p_expected_plan_source: string | null;
  /** `planRowPatch` output — the kernel decides, the RPC only applies. */
  p_patch: Record<string, unknown>;
}

/** What the RPC reports. `stale` never comes back — it raises, rolling back the claim. */
export type AppleWebhookApplyResult = "applied" | "duplicate" | "no_row";

export interface AppleWebhookStore {
  /** Row with `apple_original_transaction_id = otx`, or null. Throws on a DB error. */
  findByOriginalTransaction(originalTransactionId: string): Promise<AppleLinkedRow | null>;
  /** Claim the ledger + write the row in ONE transaction. Throws on any DB error. */
  claimAndApply(args: AppleWebhookApplyArgs): Promise<AppleWebhookApplyResult>;
  /** `sync_log`, best effort; codes only. Never called for a rejected request. */
  log(operation: string, status: "ok" | "error", message: string): Promise<void>;
}

export function applyArgs(
  decision: Extract<AppleWebhookDecision, { kind: "apply" }>,
  row: AppleLinkedRow | null,
): AppleWebhookApplyArgs {
  return {
    p_event_id: decision.notificationUUID,
    p_original_transaction_id: decision.originalTransactionId,
    p_expected_user_id: row?.user_id ?? null,
    p_expected_status: row?.status ?? null,
    p_expected_plan_source: row?.plan_source ?? null,
    p_patch: row
      ? planRowPatch({ plan: planOf(row) ?? row.status, planSource: row.plan_source }, decision.write)
      : {},
  };
}

/**
 * What a refused notification answers. Fixed strings only — never the
 * verifier's message, never which check failed (QA2 #136 S5). The code goes
 * to the log line, not the caller.
 */
export function webhookRejectBody(decision: Extract<AppleWebhookDecision, { kind: "reject" }>): Record<string, unknown> {
  return { error: decision.status === 503 ? "unavailable" : "rejected" };
}

/** One alertable single-line JSON per refused notification — codes only, never an id. */
export function webhookRejectLogLine(
  decision: Extract<AppleWebhookDecision, { kind: "reject" }>,
  runtime: BillingRuntime,
): string {
  return JSON.stringify({ event: "apple_webhook_verify", outcome: "rejected", code: decision.code, status: decision.status, runtime });
}

export interface AppleWebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface AppleWebhookRequest {
  method: string;
  /** Result of the APPLE_NOTIFICATION_SECRET URL check (`notificationSecretOk`). */
  secretOk: boolean;
  /** Parsed JSON body, or null when it didn't parse. */
  body: unknown;
}

/**
 * The whole webhook minus HTTP and Deno: verify → decide → read the row →
 * claim + write atomically. Every DB call sits inside the try; a failure
 * answers a generic retriable 500 with no detail.
 */
export async function handleAppleNotification(
  req: AppleWebhookRequest,
  cfg: AppleWebhookConfig,
  store: AppleWebhookStore,
): Promise<AppleWebhookResponse> {
  if (req.method !== "POST") return { status: 405, body: { error: "method not allowed" } };
  if (!req.secretOk) return { status: 401, body: { error: "unauthorized" } };

  const decision = await decideAppleNotification(req.body, cfg);
  if (decision.kind === "reject") {
    // Console only: an unauthenticated (possibly forged) request must cause no DB write at all.
    console.warn(webhookRejectLogLine(decision, "supabase"));
    return { status: decision.status, body: webhookRejectBody(decision) };
  }
  if (decision.kind === "ignore") return { status: 200, body: { received: true, ignored: true } };

  try {
    const row = await store.findByOriginalTransaction(decision.originalTransactionId);
    const result = await store.claimAndApply(applyArgs(decision, row));
    if (result === "duplicate") return { status: 200, body: { received: true, duplicate: true } };
    if (result === "no_row") {
      await store.log(decision.notificationType, "ok", "no matching subscription row").catch(() => {});
    }
    return { status: 200, body: { received: true } };
  } catch (e) {
    await store.log("notification", "error", e instanceof Error ? e.name : "error").catch(() => {});
    return { status: 500, body: { error: "handler failed" } };
  }
}
