/**
 * Wipe the caller's Nuvo account on Neon + Better Auth.
 *
 * Body: `{ confirm: "DELETE" }`. Owner is the verified session — a client
 * `user_id` is ignored. Billing is read by the session user.id through
 * the delete-gate reader (not the shared entitlement SELECT). A Stripe
 * subscription that is active, past_due, unpaid, or trialing blocks the wipe —
 * even when plan_source is now apple. Customer id alone does not.
 * StoreKit-only / no-card trials do not.
 * Apple users can delete and are told to cancel in Apple Account
 * settings — never a Stripe message. Wipe is one transaction; Apple
 * revoke runs only after that commit.
 */
import {
  isAccountDeleteConfirm,
} from "../../supabase/functions/_shared/accountDeletion.ts";
import { readAppleAuthConfig, revokeAppleToken } from "../../supabase/functions/_shared/appleIdentity.ts";
import { json, OPEN_CORS } from "./cors.ts";
import type { Env } from "./env.ts";
import {
  ACTIVE_STRIPE_DELETE_MESSAGE,
  APPLE_DELETE_NOTICE,
  billingPlanSource,
  BillingLookupError,
  readBillingSubscription,
  stripeSubscriptionBlocksDelete,
} from "./lib/billingRead.ts";
import { loadOwnedAppleRefreshToken, type SessionUser } from "./appleIdentity.ts";
import { wipeOwnedAccount, type Store } from "./store.ts";

/** Token-free reason when an Apple refresh row exists but will not open. */
export const APPLE_TOKEN_UNOPENABLE = "apple_token_unopenable";

/** HMAC-SHA256(user id) keyed by an existing Worker secret. Never log the key. */
async function userIdFingerprint(id: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return Array.from(new Uint8Array(mac).subarray(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fingerprintSecret(env: Env): string | null {
  const secret = (env.BETTER_AUTH_SECRET ?? env.TOKEN_ENC_KEY_V1 ?? "").trim();
  return secret || null;
}

export async function deleteOwnedAccount(
  store: Store,
  user: SessionUser,
  body: unknown,
  env: Env,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const confirm = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { confirm?: unknown }).confirm
    : undefined;
  if (!isAccountDeleteConfirm(confirm)) {
    return json({ error: "Type DELETE to confirm." }, 400, OPEN_CORS);
  }

  let billing;
  try {
    billing = await readBillingSubscription(env, user.id, fetchImpl);
  } catch (err) {
    if (err instanceof BillingLookupError) {
      return json({ error: "Could not verify billing status. Try again." }, 502, OPEN_CORS);
    }
    throw err;
  }
  if (stripeSubscriptionBlocksDelete(billing)) {
    return json({ error: ACTIVE_STRIPE_DELETE_MESSAGE }, 409, OPEN_CORS);
  }

  // Load the refresh token before wipe — the row is gone after commit.
  const loaded = await loadOwnedAppleRefreshToken(store, user.id, env).catch(() => null);

  const { planner, auth } = await wipeOwnedAccount(store.sql, {
    plannerUserId: store.userId,
    authUserId: user.id,
  });
  if (planner === 0 && auth === 0) {
    return json({ error: "not found" }, 404, OPEN_CORS);
  }

  let appleRevoked: boolean | null = null;
  if (loaded && !loaded.token) {
    appleRevoked = false;
    const secret = fingerprintSecret(env);
    const line: { reason: string; source: string; user?: string } = {
      reason: APPLE_TOKEN_UNOPENABLE,
      source: loaded.source,
    };
    if (secret) line.user = await userIdFingerprint(user.id, secret);
    console.warn("delete-account:", APPLE_TOKEN_UNOPENABLE, line);
  } else if (loaded?.token) {
    const config = readAppleAuthConfig({
      APPLE_CLIENT_ID: env.APPLE_CLIENT_ID,
      APPLE_SIWA_TEAM_ID: env.APPLE_SIWA_TEAM_ID,
      APPLE_SIWA_KEY_ID: env.APPLE_SIWA_KEY_ID,
      APPLE_SIWA_PRIVATE_KEY: env.APPLE_SIWA_PRIVATE_KEY,
      APPLE_SIWA_CLIENT_ID: env.APPLE_SIWA_CLIENT_ID,
      APPLE_BUNDLE_ID: env.APPLE_BUNDLE_ID,
    }, loaded.source);
    if (config) {
      appleRevoked = await revokeAppleToken(config, loaded.token).catch(() => false);
    } else {
      appleRevoked = false;
    }
  }
  const payload: { ok: true; appleRevoked: boolean | null; notice?: string } = { ok: true, appleRevoked };
  if (billingPlanSource(billing) === "apple") {
    payload.notice = APPLE_DELETE_NOTICE;
  }
  return json(payload, 200, OPEN_CORS);
}
