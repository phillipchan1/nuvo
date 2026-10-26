/**
 * Wipe the caller's Nuvo account on Neon + Better Auth.
 *
 * Body: `{ confirm: "DELETE" }`. Owner is the verified session — a client
 * `user_id` is ignored. While a Stripe subscription is still active (read
 * from Supabase `subscriptions`, never via the Stripe API) the wipe is
 * refused. Apple revoke is best-effort (guideline 5.1.1(v)).
 */
import {
  isAccountDeleteConfirm,
} from "../../supabase/functions/_shared/accountDeletion.ts";
import { readAppleAuthConfig, revokeAppleToken } from "../../supabase/functions/_shared/appleIdentity.ts";
import { json, OPEN_CORS } from "./cors.ts";
import type { Env } from "./env.ts";
import {
  ACTIVE_STRIPE_DELETE_MESSAGE,
  BillingLookupError,
  readBillingSubscription,
  stripeSubscriptionBlocksDelete,
} from "./lib/billingRead.ts";
import { loadOwnedAppleRefreshToken, type SessionUser } from "./appleIdentity.ts";
import { wipeBetterAuthUser, wipePlannerUser, type Store } from "./store.ts";

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
    billing = await readBillingSubscription(env, store.userId);
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

  const planner = await wipePlannerUser(store);
  const auth = await wipeBetterAuthUser(store.sql, user.id);
  if (planner === 0 && auth === 0) {
    return json({ error: "not found" }, 404, OPEN_CORS);
  }
  return json({ ok: true, appleRevoked }, 200, OPEN_CORS);
}
