// Wipes the caller's Nuvo account. Authenticated (verify_jwt defaults true).
// Body: { confirm: "DELETE" }. Cancels a Stripe subscription if one exists.
// Apple / StoreKit subscriptions cannot be cancelled here — the UI says so.
//
// A Sign-in-with-Apple account also has to have its Apple grant REVOKED here
// (/auth/revoke). That is not politeness: guideline 5.1.1(v) makes it a
// rejection reason on its own. It is still best-effort — Apple being
// unreachable must not leave a user unable to delete their account — and the
// response says whether it happened.
import { admin, deleteSecret, handleOptions, json, readSecret, requireUser } from "../_shared/admin.ts";
import {
  isAccountDeleteConfirm,
  isIgnorableStripeCancelError,
  stripeSubscriptionIdToCancel,
} from "../_shared/accountDeletion.ts";
import { readAppleAuthConfig, revokeAppleToken } from "../_shared/appleIdentity.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (!isAccountDeleteConfirm(body?.confirm)) {
      return json({ error: "Type DELETE to confirm." }, 400);
    }

    const { data: sub } = await admin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const stripeSubId = stripeSubscriptionIdToCancel(sub);
    if (stripeSubId) {
      try {
        const { stripe } = await import("../_shared/stripe.ts");
        await stripe.subscriptions.cancel(stripeSubId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!isIgnorableStripeCancelError(msg)) {
          return json({
            error:
              "Could not cancel your Stripe subscription. Open Settings → Billing, cancel there, then delete again.",
          }, 502);
        }
      }
    }

    const secretIds = new Set<string>();

    // Apple first: once auth.users is gone we can no longer prove who this was,
    // and the token lives in the vault we are about to empty.
    let appleRevoked: boolean | null = null;
    const { data: appleIdentity } = await admin
      .from("apple_identities")
      .select("refresh_token_secret_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const appleSecretId = (appleIdentity?.refresh_token_secret_id as string | null) ?? null;
    if (appleSecretId) {
      secretIds.add(appleSecretId);
      const config = readAppleAuthConfig(Deno.env.toObject());
      if (config) {
        try {
          const token = await readSecret(appleSecretId);
          // null = revoke was configured but Apple refused; false is a real
          // signal in the response, distinct from "no Apple identity here".
          appleRevoked = token ? await revokeAppleToken(config, token) : false;
        } catch {
          appleRevoked = false;
        }
      } else {
        appleRevoked = false;
      }
    }

    const { data: accounts } = await admin
      .from("calendar_accounts")
      .select("refresh_token_secret_id, provider")
      .eq("user_id", user.id);
    for (const account of accounts ?? []) {
      const secretId = account.refresh_token_secret_id as string | null;
      if (!secretId) continue;
      secretIds.add(secretId);
      if (account.provider === "google") {
        try {
          const token = await readSecret(secretId);
          if (token) await revokeGoogleToken(token);
        } catch {
          /* best effort — wipe still proceeds */
        }
      }
    }

    const { data: sources } = await admin
      .from("activity_sources")
      .select("token_secret_id")
      .eq("user_id", user.id);
    for (const source of sources ?? []) {
      if (source.token_secret_id) secretIds.add(source.token_secret_id as string);
    }

    for (const id of secretIds) {
      try {
        await deleteSecret(id);
      } catch {
        /* orphaned vault row is worse than a failed wipe; keep going */
      }
    }

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, appleRevoked });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

async function revokeGoogleToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
}
