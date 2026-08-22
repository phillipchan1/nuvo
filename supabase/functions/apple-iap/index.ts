// Verify a StoreKit purchase for the signed-in account and write the one
// entitlement row. Authenticated — the iOS binary calls this after a
// successful transaction. Renewals / refunds arrive via apple-webhook.
import { handleOptions, json, requireUser } from "../_shared/admin.ts";
import { appleDateToIso, asString, readIapEnv } from "../_shared/apple.ts";
import { applyPlanUpdate } from "../_shared/plan.ts";
import { isOurIapProduct } from "../_shared/planRules.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const productId = asString(body?.productId);
    const originalTransactionId = asString(body?.originalTransactionId);
    const transactionId = asString(body?.transactionId);
    if (!productId || !originalTransactionId) {
      return json({ error: "productId and originalTransactionId are required" }, 400);
    }
    if (!isOurIapProduct(productId, readIapEnv())) {
      return json({ error: "unknown App Store product" }, 400);
    }

    const result = await applyPlanUpdate({
      userId: user.id,
      plan: "active",
      planSource: "apple",
      currentPeriodEnd: appleDateToIso(body?.expiresDate),
      cancelAtPeriodEnd: body?.cancelAtPeriodEnd === true,
      appleOriginalTransactionId: originalTransactionId,
      appleProductId: productId,
    });
    if (!result.applied) return json({ error: "no subscription row" }, 404);

    return json({
      ok: true,
      transactionId,
      originalTransactionId,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
