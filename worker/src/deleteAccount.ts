/**
 * Wipe the caller's Nuvo account on Neon + Better Auth.
 *
 * Body: `{ confirm: "DELETE" }`. Owner is the verified session — a client
 * `user_id` is ignored. Billing is read by the session user.id (entitlement
 * contract). A Stripe row that is active, past_due, or unrecognized blocks
 * the wipe. StoreKit / no-card trials do not. Apple users can delete
 * and are told to cancel in Apple Account settings — never a Stripe
 * message. Wipe is one transaction.
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

export async function deleteOwnedAccount(
  store: Store,
  user: SessionUser,
  body: unknown,
  env: Env,
): Promise<Response> {
  const confirm = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { confirm?: unknown }).confirm
    : undefined;
  if (!isAccountDeleteConfirm(confirm)) {
    return json({ error: "Type DELETE to confirm." }, 400, OPEN_CORS);
  }

  let billing;
  try {
    billing = await readBillingSubscription(env, user.id);
  } catch (err) {
    if (err instanceof BillingLookupError) {
      return json({ error: "Could not verify billing status. Try again." }, 502, OPEN_CORS);
    }
    throw err;
  }
  if (stripeSubscriptionBlocksDelete(billing)) {
    return json({ error: ACTIVE_STRIPE_DELETE_MESSAGE }, 409, OPEN_CORS);
  }

  let appleRevoked: boolean | null = null;
  const token = await loadOwnedAppleRefreshToken(store, user.id, env).catch(() => null);
  if (token) {
    const config = readAppleAuthConfig({
      APPLE_SIWA_TEAM_ID: env.APPLE_SIWA_TEAM_ID,
      APPLE_SIWA_KEY_ID: env.APPLE_SIWA_KEY_ID,
      APPLE_SIWA_PRIVATE_KEY: env.APPLE_SIWA_PRIVATE_KEY,
      APPLE_SIWA_CLIENT_ID: env.APPLE_SIWA_CLIENT_ID,
      APPLE_BUNDLE_ID: env.APPLE_BUNDLE_ID,
    });
    if (config) {
      appleRevoked = await revokeAppleToken(config, token).catch(() => false);
    } else {
      appleRevoked = false;
    }
  }

  const { planner, auth } = await wipeOwnedAccount(store.sql, {
    plannerUserId: store.userId,
    authUserId: user.id,
  });
  if (planner === 0 && auth === 0) {
    return json({ error: "not found" }, 404, OPEN_CORS);
  }
  const payload: { ok: true; appleRevoked: boolean | null; notice?: string } = { ok: true, appleRevoked };
  if (billingPlanSource(billing) === "apple") {
    payload.notice = APPLE_DELETE_NOTICE;
  }
  return json(payload, 200, OPEN_CORS);
}
