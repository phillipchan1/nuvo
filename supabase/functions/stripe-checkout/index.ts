// Creates a Stripe Checkout session for the caller's own subscription.
// Authenticated (verify_jwt defaults true) — the client calls this via
// supabase.functions.invoke("stripe-checkout", { body: { plan } }).
// Optional body.code: a friend Promotion Code to pre-apply (from ?code=).
import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import { resolveReturnOrigin, stripe } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan;
    if (plan !== "monthly" && plan !== "annual") {
      return json({ error: "plan must be 'monthly' or 'annual'" }, 400);
    }
    const priceId =
      plan === "annual" ? Deno.env.get("STRIPE_PRICE_ANNUAL")! : Deno.env.get("STRIPE_PRICE_MONTHLY")!;

    const { data: existing } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    // Come back to wherever the request came from (dev machine or production),
    // not to one hardcoded APP_URL.
    const appUrl = resolveReturnOrigin(body?.origin);

    // Friend code from ?code= (client localStorage → body.code). Stripe forbids
    // combining `discounts` with `allow_promotion_codes`, so we pick one path.
    let discounts: { promotion_code: string }[] | undefined;
    let allowPromotionCodes = true;
    const rawCode = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    if (rawCode) {
      const listed = await stripe.promotionCodes.list({ code: rawCode, limit: 1, active: true });
      const promo = listed.data[0];
      const referrer = promo?.metadata?.referrer_user_id;
      const isOurs = promo?.metadata?.app === "nuvo" && promo?.metadata?.kind === "referral";
      if (promo && isOurs && referrer && referrer !== user.id) {
        discounts = [{ promotion_code: promo.id }];
        allowPromotionCodes = false;
      }
      // Self-referral or unknown code: fall through to the open field so they
      // can still type a different code manually.
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: existing?.stripe_customer_id ?? undefined,
      customer_email: existing?.stripe_customer_id ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      // `app` tags every object as ours: this Stripe account also sells
      // Dayspring, so the shared webhook endpoint must be able to tell the
      // two apart. `user_id` rides along on every subsequent
      // customer.subscription.* event, so the handler never has to
      // round-trip Stripe's API to resolve which account an event is for.
      metadata: { app: "nuvo", user_id: user.id },
      subscription_data: { metadata: { app: "nuvo", user_id: user.id } },
      success_url: `${appUrl}/?checkout=success`,
      cancel_url: `${appUrl}/?checkout=cancelled`,
      ...(discounts ? { discounts } : {}),
      allow_promotion_codes: allowPromotionCodes,
    });

    return json({ url: session.url });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
