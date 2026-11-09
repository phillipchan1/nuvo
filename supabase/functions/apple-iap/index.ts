// Verify a StoreKit purchase for the signed-in account and write the one
// entitlement row. Authenticated — the iOS binary calls this after a
// successful transaction. Renewals / refunds arrive via apple-webhook.
//
// Nothing about the purchase is taken from the request body: the decision is
// `confirmAppleTransaction` (_shared/appleIap.ts, the same function the
// Worker's route runs), which verifies the App Store JWS against Apple Root
// CA - G3 and reads product, expiry, bundle, environment, ids, token and
// revocation from the signed payload. iOS 1.2+ sends `jwsRepresentation`;
// 1.1 sends only ids, so the transaction is fetched from the App Store Server
// API by `transactionId` (needs APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID /
// APPLE_IAP_PRIVATE_KEY — without them a 1.1 confirm is a retriable 503).
// An account paying on Stripe is refused 409 `active_on_other_rail` — a
// confirm never flips the rail. Every refusal logs one JSON line
// (`iapVerifyLogLine`, codes only) for alerting.
import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import { appleBundleId, readIapEnv } from "../_shared/apple.ts";
import { confirmAppleTransaction, iapRejectionBody, iapVerifyLogLine, type RailRow } from "../_shared/appleIap.ts";
import { appStoreApiCredentialsFrom } from "../_shared/appStoreServerApi.ts";
import { applyPlanUpdate } from "../_shared/plan.ts";

async function ownerOfOriginalTransaction(originalTransactionId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("apple_original_transaction_id", originalTransactionId)
    .maybeSingle();
  if (error) throw new Error("subscription lookup failed");
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

async function railRowOf(userId: string): Promise<RailRow | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("apple_original_transaction_id, status, plan_source, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("subscription lookup failed");
  return (data as RailRow | null) ?? null;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const verdict = await confirmAppleTransaction(body, user.id, {
      bundleId: appleBundleId(),
      iapEnv: readIapEnv(),
      apiCredentials: appStoreApiCredentialsFrom((k) => Deno.env.get(k)),
      ownerOfOriginalTransaction,
      railRowOf,
    });
    if (!verdict.ok) {
      console.warn(iapVerifyLogLine(verdict, "supabase"));
      return json(iapRejectionBody(verdict), verdict.status);
    }

    const result = await applyPlanUpdate(verdict.write);
    if (!result.applied) return json({ error: "no subscription row" }, 404);

    return json({
      ok: true,
      transactionId: verdict.tx.transactionId,
      originalTransactionId: verdict.tx.originalTransactionId,
      environment: verdict.tx.environment,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("apple-iap: failed", e instanceof Error ? e.name : "error");
    return json({ error: "Couldn’t confirm the App Store purchase. Try again." }, 500);
  }
});
