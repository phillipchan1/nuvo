// Creates a Stripe Billing Portal session for the caller's own subscription.
// Authenticated (verify_jwt defaults true).
import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import { resolveReturnOrigin, stripe } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const { data: row } = await admin
      .from("subscriptions")
      .select("stripe_customer_id, plan_source")
      .eq("user_id", user.id)
      .maybeSingle();

    if (row?.plan_source === "apple" && !row.stripe_customer_id) {
      return json({ error: "This subscription is managed through the App Store." }, 409);
    }

    if (!row?.stripe_customer_id) {
      return json({ error: "No billing account yet — subscribe first." }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: resolveReturnOrigin(body?.origin),
    });

    return json({ url: session.url });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
