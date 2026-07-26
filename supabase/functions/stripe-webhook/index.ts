// Stripe calls this directly (server-to-server, no Supabase JWT) — it
// verifies the Stripe signature itself instead of requireUser(), so this
// function is registered with verify_jwt=false in supabase/config.toml.
// No CORS/OPTIONS handling needed: Stripe never sends a browser preflight.
import Stripe from "npm:stripe@18";
import { admin, logSync } from "../_shared/admin.ts";
import { stripe, stripeStatusToStatus } from "../_shared/stripe.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// This Stripe account also sells Dayspring, so this endpoint receives that
// app's subscription events too. Every Nuvo object is tagged `app: "nuvo"`
// at Checkout time (see stripe-checkout), and its price is always one of
// ours — anything else is another product's event and must be ignored
// outright rather than left to "probably match no rows".
const NUVO_PRICES = new Set(
  [Deno.env.get("STRIPE_PRICE_MONTHLY"), Deno.env.get("STRIPE_PRICE_ANNUAL")].filter(Boolean),
);

function isOurSubscription(sub: Stripe.Subscription): boolean {
  if (sub.metadata?.app === "nuvo") return true;
  return sub.items.data.some((i) => i.price?.id && NUVO_PRICES.has(i.price.id));
}

/** Stripe moved `current_period_end` off the Subscription onto each
 *  subscription item in API version 2025-03-31.basil; we're pinned past
 *  that, so read the item first and only fall back to the legacy top-level
 *  field. Returns null rather than throwing on a missing/!finite value —
 *  a bad date must not fail the whole handler, because the idempotency
 *  claim above means Stripe's retry would be skipped as a duplicate. */
function periodEndISO(sub: Stripe.Subscription): string | null {
  // deno-lint-ignore no-explicit-any
  const item = sub.items?.data?.[0] as any;
  // deno-lint-ignore no-explicit-any
  const secs = item?.current_period_end ?? (sub as any).current_period_end;
  if (typeof secs !== "number" || !Number.isFinite(secs)) return null;
  return new Date(secs * 1000).toISOString();
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    // Deno needs the async + Web Crypto variant — Stripe's default
    // constructEvent uses Node's sync crypto, unavailable here.
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

  // Idempotency: claim the event id before handling, so a concurrent
  // redelivery can't double-apply. If the handler then fails we release the
  // claim (see the catch below) — otherwise a deterministic bug would burn
  // the claim on the first delivery and Stripe's retries would all
  // short-circuit as duplicates, turning a transient failure permanent.
  const { error: dupe } = await admin.from("stripe_webhook_events").insert({ event_id: event.id });
  if (dupe) return json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.app !== "nuvo") break; // another product's checkout
        const userId = session.client_reference_id;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        if (userId && customerId) {
          await admin.from("subscriptions").update({ stripe_customer_id: customerId }).eq("user_id", userId);
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
          // Defensive fallback — metadata.user_id should always be present
          // since stripe-checkout sets it, but don't drop the event if not.
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
      case "invoice.payment_failed": {
        // Log only — never mutate status here. Stripe auto-retries failed
        // invoices; `past_due` is written exclusively from
        // customer.subscription.updated's own status field, so a single
        // card blip doesn't instant-lock a paying user.
        // Line-item price moved to `pricing.price_details.price` in recent
        // API versions; check both shapes so this stays a log-only no-op
        // rather than an exception if Stripe reshapes it again.
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
        break; // unhandled events are fine
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Release the idempotency claim so Stripe's automatic retry gets a real
    // second attempt instead of being turned away as a duplicate.
    await admin.from("stripe_webhook_events").delete().eq("event_id", event.id);
    await logSync("stripe", event.type, "error", msg);
    return json({ error: "handler failed" }, 500);
  }

  return json({ received: true });
});
