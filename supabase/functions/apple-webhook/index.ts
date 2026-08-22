// App Store Server Notifications V2. Apple calls this directly (no JWT) —
// verify_jwt=false in config.toml. Optional APPLE_NOTIFICATION_SECRET on the
// URL, then decode the signed payload and write the same plan updater Stripe
// uses. No prices. Product ids must match NUVO_IAP_* when those are set.
import { admin, logSync } from "../_shared/admin.ts";
import {
  appleBundleId,
  appleDateToIso,
  asString,
  decodeJwsPayload,
  notificationSecretOk,
  readIapEnv,
} from "../_shared/apple.ts";
import { applyPlanUpdate } from "../_shared/plan.ts";
import { appleNotificationToPlan, isOurIapProduct } from "../_shared/planRules.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!notificationSecretOk(req)) return new Response("unauthorized", { status: 401 });

  const raw = await req.json().catch(() => null);
  const signedPayload = asString((raw as { signedPayload?: unknown } | null)?.signedPayload);
  if (!signedPayload) return new Response("missing signedPayload", { status: 400 });

  let notification: Record<string, unknown>;
  try {
    notification = decodeJwsPayload(signedPayload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`invalid signedPayload: ${msg}`, { status: 400 });
  }

  const notificationUUID = asString(notification.notificationUUID);
  if (notificationUUID) {
    const { error: dupe } = await admin
      .from("apple_webhook_events")
      .insert({ event_id: notificationUUID });
    if (dupe) return json({ received: true, duplicate: true });
  }

  try {
    const notificationType = asString(notification.notificationType) ?? "";
    const subtype = asString(notification.subtype);
    const mapped = appleNotificationToPlan(notificationType, subtype);
    if (!mapped) return json({ received: true, ignored: true });

    const data = notification.data;
    const signedTx =
      data && typeof data === "object"
        ? asString((data as { signedTransactionInfo?: unknown }).signedTransactionInfo)
        : null;
    if (!signedTx) return json({ received: true, ignored: true });

    const tx = decodeJwsPayload(signedTx);
    const bundle = appleBundleId();
    const txBundle = asString(tx.bundleId);
    if (bundle && txBundle && txBundle !== bundle) {
      return json({ received: true, ignored: true });
    }

    const productId = asString(tx.productId);
    const env = readIapEnv();
    if (env.NUVO_IAP_MONTHLY || env.NUVO_IAP_ANNUAL) {
      if (!isOurIapProduct(productId, env)) return json({ received: true, ignored: true });
    }

    const originalTransactionId = asString(tx.originalTransactionId);
    if (!originalTransactionId) return json({ received: true, ignored: true });

    const result = await applyPlanUpdate({
      plan: mapped.plan,
      planSource: "apple",
      currentPeriodEnd: appleDateToIso(tx.expiresDate),
      cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
      appleOriginalTransactionId: originalTransactionId,
      appleProductId: productId,
    });
    if (!result.applied) {
      await logSync("apple", notificationType, "ok", "no matching subscription row");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (notificationUUID) {
      await admin.from("apple_webhook_events").delete().eq("event_id", notificationUUID);
    }
    await logSync("apple", "notification", "error", msg);
    return json({ error: "handler failed" }, 500);
  }

  return json({ received: true });
});
