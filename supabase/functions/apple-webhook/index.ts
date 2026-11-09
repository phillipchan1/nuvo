// App Store Server Notifications V2. Apple calls this directly (no JWT) —
// verify_jwt=false in config.toml. The decision is `handleAppleNotification`
// (_shared/appleWebhook.ts): the outer signedPayload and the nested
// signedTransactionInfo / signedRenewalInfo are verified against Apple Root
// CA - G3, bundle and environment checked, and plan / expiry / product /
// environment derived from the verified payloads only. APPLE_NOTIFICATION_SECRET
// on the URL stays as an extra layer when it is set. APPLE_BUNDLE_ID unset → 503.
//
// DEPLOY ORDER: migration 00000000000092_apple_webhook_apply must be applied
// before this function is deployed — the ledger claim and the row write are
// one transaction inside `public.apple_webhook_apply`.
import { admin, logSync } from "../_shared/admin.ts";
import { appleBundleId, notificationSecretOk, readIapEnv } from "../_shared/apple.ts";
import {
  handleAppleNotification,
  type AppleLinkedRow,
  type AppleWebhookApplyResult,
  type AppleWebhookStore,
} from "../_shared/appleWebhook.ts";

const store: AppleWebhookStore = {
  async findByOriginalTransaction(originalTransactionId) {
    const { data, error } = await admin
      .from("subscriptions")
      .select("user_id, status, plan_source")
      .eq("apple_original_transaction_id", originalTransactionId)
      .maybeSingle();
    if (error) throw new Error("subscription lookup failed");
    return (data as AppleLinkedRow | null) ?? null;
  },
  async claimAndApply(args) {
    const { data, error } = await admin.rpc("apple_webhook_apply", args);
    if (error) throw new Error("apple_webhook_apply failed");
    if (data !== "applied" && data !== "duplicate" && data !== "no_row") {
      throw new Error("apple_webhook_apply returned an unknown result");
    }
    return data as AppleWebhookApplyResult;
  },
  async log(operation, status, message) {
    await logSync("apple", operation, status, message);
  },
};

Deno.serve(async (req) => {
  const secretOk = notificationSecretOk(req);
  const out = await handleAppleNotification(
    {
      method: req.method,
      secretOk,
      body: req.method === "POST" && secretOk ? await req.json().catch(() => null) : null,
    },
    { bundleId: appleBundleId(), iapEnv: readIapEnv() },
    store,
  );
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { "Content-Type": "application/json" },
  });
});
