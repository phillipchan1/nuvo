// Stripe calls this directly (server-to-server, no Supabase JWT) — it
// verifies the Stripe signature itself instead of requireUser(), so this
// function is registered with verify_jwt=false in supabase/config.toml.
// No CORS/OPTIONS handling needed: Stripe never sends a browser preflight.
import Stripe from "npm:stripe@18";
import { admin, logSync } from "../_shared/admin.ts";
import {
  REFERRAL_MONTHLY_CREDIT_CENTS,
  monthsCreditRemaining,
} from "../_shared/referralOffer.ts";
import { stripe, stripeStatusToStatus } from "../_shared/stripe.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const NUVO_PRICES = new Set(
  [Deno.env.get("STRIPE_PRICE_MONTHLY"), Deno.env.get("STRIPE_PRICE_ANNUAL")].filter(Boolean),
);

function isOurSubscription(sub: Stripe.Subscription): boolean {
  if (sub.metadata?.app === "nuvo") return true;
  return sub.items.data.some((i) => i.price?.id && NUVO_PRICES.has(i.price.id));
}

function isOurInvoice(invoice: Stripe.Invoice): boolean {
  // deno-lint-ignore no-explicit-any
  const lines = ((invoice as any)?.lines?.data ?? []) as any[];
  return lines.some((l) => {
    const id = l?.price?.id ?? l?.pricing?.price_details?.price;
    return typeof id === "string" && NUVO_PRICES.has(id);
  });
}

function periodEndISO(sub: Stripe.Subscription): string | null {
  // deno-lint-ignore no-explicit-any
  const item = sub.items?.data?.[0] as any;
  // deno-lint-ignore no-explicit-any
  const secs = item?.current_period_end ?? (sub as any).current_period_end;
  if (typeof secs !== "number" || !Number.isFinite(secs)) return null;
  return new Date(secs * 1000).toISOString();
}

async function referralFromCheckout(
  session: Stripe.Checkout.Session,
): Promise<{ referrerUserId: string; code: string } | null> {
  const userId = session.client_reference_id ?? session.metadata?.user_id;
  if (!userId) return null;
  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["total_details.breakdown.discounts.discount.promotion_code"],
    });
    // deno-lint-ignore no-explicit-any
    const discounts = (full as any)?.total_details?.breakdown?.discounts as any[] | undefined;
    // deno-lint-ignore no-explicit-any
    const promo = discounts?.map((d) => d?.discount?.promotion_code).find((p: any) => p && typeof p === "object");
    if (!promo) {
      // deno-lint-ignore no-explicit-any
      const sessionDiscounts = (full as any)?.discounts as any[] | undefined;
      for (const d of sessionDiscounts ?? []) {
        const p = typeof d?.promotion_code === "object" ? d.promotion_code : null;
        if (p) return acceptPromo(p, userId);
      }
      return null;
    }
    return acceptPromo(promo, userId);
  } catch {
    return null;
  }
}

function acceptPromo(
  // deno-lint-ignore no-explicit-any
  promo: any,
  checkoutUserId: string,
): { referrerUserId: string; code: string } | null {
  if (promo?.metadata?.app !== "nuvo" || promo?.metadata?.kind !== "referral") return null;
  const referrer = promo.metadata?.referrer_user_id;
  if (typeof referrer !== "string" || !referrer) return null;
  if (referrer === checkoutUserId) return null;
  const code = typeof promo.code === "string" ? promo.code : null;
  if (!code) return null;
  return { referrerUserId: referrer, code };
}

/**
 * Friend paid → credit the referrer one free month (Customer Balance), if
 * under the 6-month outstanding cap and we haven't already rewarded this
 * conversion.
 */
async function maybeCreditReferrer(invoice: Stripe.Invoice): Promise<void> {
  if (invoice.status !== "paid") return;
  if (!isOurInvoice(invoice)) return;
  // deno-lint-ignore no-explicit-any
  const reason = (invoice as any).billing_reason as string | undefined;
  if (reason && reason !== "subscription_create") return;

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const { data: friend } = await admin
    .from("subscriptions")
    .select("user_id, referred_by, referral_reward_granted_at, referral_code_used")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!friend?.referred_by || friend.referral_reward_granted_at) return;

  const { data: referrer } = await admin
    .from("subscriptions")
    .select("user_id, stripe_customer_id")
    .eq("user_id", friend.referred_by)
    .maybeSingle();
  if (!referrer?.stripe_customer_id) {
    await logSync(
      "stripe",
      "referral_credit_skipped",
      "error",
      "referrer has no stripe_customer_id yet",
      friend.referred_by,
    );
    return;
  }

  const cust = await stripe.customers.retrieve(referrer.stripe_customer_id);
  if (cust.deleted) return;
  const balance = typeof cust.balance === "number" ? cust.balance : 0;
  if (monthsCreditRemaining(balance) < 1) {
    await logSync(
      "stripe",
      "referral_credit_capped",
      "ok",
      "referrer already at 6 months outstanding credit",
      friend.referred_by,
    );
    await admin
      .from("subscriptions")
      .update({ referral_reward_granted_at: new Date().toISOString() })
      .eq("user_id", friend.user_id);
    return;
  }

  await stripe.customers.createBalanceTransaction(referrer.stripe_customer_id, {
    amount: -REFERRAL_MONTHLY_CREDIT_CENTS,
    currency: "usd",
    description: `Nuvo friend-code reward (${friend.referral_code_used ?? "code"} → paid)`,
    metadata: {
      app: "nuvo",
      kind: "referral_reward",
      referred_user_id: friend.user_id,
      invoice_id: invoice.id,
    },
  });

  await admin
    .from("subscriptions")
    .update({ referral_reward_granted_at: new Date().toISOString() })
    .eq("user_id", friend.user_id);

  await logSync("stripe", "referral_credit", "ok", undefined, friend.referred_by);
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    const cryptoProvider = Stripe.createSubtleCryptoProvider();
    event = await stripe.webhooks.constructEventAsync(
      raw,
      sig,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`signature verification failed: ${msg}`, { status: 400 });
  }

  const { error: dupe } = await admin.from("stripe_webhook_events").insert({ event_id: event.id });
  if (dupe) return json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.app !== "nuvo") break;
        const userId = session.client_reference_id;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        if (userId && customerId) {
          await admin.from("subscriptions").update({ stripe_customer_id: customerId }).eq("user_id", userId);
        }
        if (userId) {
          const ref = await referralFromCheckout(session);
          if (ref) {
            const { data: current } = await admin
              .from("subscriptions")
              .select("referred_by")
              .eq("user_id", userId)
              .maybeSingle();
            if (!current?.referred_by) {
              await admin
                .from("subscriptions")
                .update({
                  referred_by: ref.referrerUserId,
                  referral_code_used: ref.code,
                })
                .eq("user_id", userId);
            }
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (!isOurSubscription(sub)) break;
        const userId = sub.metadata?.user_id;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const patch = {
          status: stripeStatusToStatus(sub.status),
          stripe_subscription_id: sub.id,
          stripe_customer_id: customerId,
          price_id: sub.items.data[0]?.price?.id ?? null,
          current_period_end: periodEndISO(sub),
          cancel_at_period_end: sub.cancel_at_period_end,
        };
        if (userId) {
          await admin.from("subscriptions").update(patch).eq("user_id", userId);
        } else {
          await admin.from("subscriptions").update(patch).eq("stripe_customer_id", customerId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (!isOurSubscription(sub)) break;
        const userId = sub.metadata?.user_id;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const patch = { status: "cancelled" as const, cancel_at_period_end: false };
        if (userId) {
          await admin.from("subscriptions").update(patch).eq("user_id", userId);
        } else {
          await admin.from("subscriptions").update(patch).eq("stripe_customer_id", customerId);
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await maybeCreditReferrer(invoice);
        break;
      }
      case "invoice.payment_failed": {
        // deno-lint-ignore no-explicit-any
        const lines = ((event.data.object as any)?.lines?.data ?? []) as any[];
        const ours = lines.some((l) => {
          const id = l?.price?.id ?? l?.pricing?.price_details?.price;
          return typeof id === "string" && NUVO_PRICES.has(id);
        });
        if (ours) await logSync("stripe", "invoice.payment_failed", "ok");
        break;
      }
      default:
        break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("stripe_webhook_events").delete().eq("event_id", event.id);
    await logSync("stripe", event.type, "error", msg);
    return json({ error: "handler failed" }, 500);
  }

  return json({ received: true });
});
