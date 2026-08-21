# Billing setup (Stripe)

One-time wiring for Nuvo's subscription billing.

> **Status: configured and proven in LIVE mode** (July 2026). A real Monthly
> subscription was purchased end-to-end — checkout → webhook → `subscriptions`
> row — so the pipeline is verified in production. There is **no test-mode
> setup**: Stripe keeps test and live products, prices, webhooks, and keys
> completely separate, so `4242 4242 4242 4242` will be **declined**. To
> rehearse without moving money, make a 100%-off coupon (checkout has
> `allow_promotion_codes`) rather than using a test card. The steps below are
> the record of what was set up, and the recipe if it ever needs redoing.

**Pricing:** $29/mo monthly · $19/mo billed annually ($228/yr). One Product,
two Prices. 14-day no-card trial granted app-side (not by Stripe).

**Shared account note:** this Stripe account also sells Dayspring. Every Nuvo
Checkout tags its session + subscription with `metadata.app = "nuvo"`, and
`stripe-webhook` ignores any event that isn't Nuvo's (by tag or by price id),
so the two products can share one webhook endpoint safely.

---

## 1. Create the Product and two Prices (Stripe dashboard)

Toggle **Test mode** on (top-right switch) before doing any of this.

1. **Product catalog** → **+ Add product**
2. Name `Nuvo`, description whatever you like
3. Under Pricing: **Recurring**, `$29.00` / **Monthly** → Add product
4. Open the product → **+ Add another price** → **Recurring**, `$228.00` /
   **Yearly**
5. Copy both **price IDs** (they look like `price_1AbC...`, found on each price
   row). One is monthly, one is annual — keep them straight.

## 2. Turn on the Customer Portal (easy to miss)

`stripe-portal` fails until this is activated, per Stripe's rules.

**Settings → Billing → Customer portal** → activate. Turn on "Allow customers
to update payment methods" and "Allow customers to cancel subscriptions".

## 3. Create the webhook endpoint

**Developers → Webhooks → + Add endpoint**

- Endpoint URL: `https://ebibzojtkzkphykznomv.supabase.co/functions/v1/stripe-webhook`
- Events to send — select exactly these five:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Add endpoint, then copy the **Signing secret** (`whsec_...`)

## 4. Grab the secret key

**Developers → API keys** → reveal the **Secret key** (`sk_test_...`).

## 5. Set the Supabase secrets

Run this yourself so the keys never travel through a chat log. Fill in the four
values you copied above:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxx \
  STRIPE_PRICE_MONTHLY=price_xxx \
  STRIPE_PRICE_ANNUAL=price_xxx \
  APP_URL=https://app.nuvo.day
```

## 6. Apply the migration

Creates `subscriptions` + `stripe_webhook_events`, adds the `entitled()`
computed column, and extends `handle_new_user` to grant the 14-day trial.
**It also backfills a fresh 14-day trial onto every existing account,
including yours** — there's no founder override by design, so you see exactly
what a real user sees.

```bash
supabase db push
```

## 7. Deploy the functions

```bash
supabase functions deploy stripe-checkout stripe-portal stripe-webhook
```

`stripe-webhook` is declared `verify_jwt = false` in `supabase/config.toml`
(Stripe calls it directly with no Supabase JWT — it verifies Stripe's own
signature instead).

## 8. Test the whole loop

1. `npm run dev`, open the app — you should land in the app with a
   **"14 days left in your trial"** banner across the top.
2. Settings → **Billing** → click **Annual**. You land on Stripe Checkout.
3. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.
4. You get redirected back; the banner disappears and Settings → Billing now
   shows an active plan with a renewal date. If it hangs on "Setting up your
   subscription…", the webhook isn't landing — check
   **Developers → Webhooks → your endpoint → recent deliveries** for the error.
5. Settings → Billing → **Manage billing** should open the Stripe portal.
6. Cancel the subscription in the portal → the app should flip to the paywall
   **without a reload** (realtime).

To see the expired-trial paywall on demand, in the Supabase SQL editor:

```sql
-- lock yourself out
update public.subscriptions set trial_ends_at = now() - interval '1 day'
where user_id = auth.uid();

-- give yourself the trial back
update public.subscriptions set trial_ends_at = now() + interval '14 days'
where user_id = auth.uid();
```

## 9. Going live

Flip Stripe out of test mode and redo **steps 1, 2, 3, and 4** in live mode
(live products, prices, portal config, webhook endpoint, and keys are all
entirely separate from test). Then re-run step 5 with the live values.

Also confirm **Supabase → Authentication → Sign-ups are enabled** — the app is
multi-tenant now, not single-user.

---

## How it works (for future you)

- **Entitlement** is one Postgres function, `entitled(subscriptions)`, exposed
  as a computed column. The client reads `sub.entitled` and never re-derives
  the date math. There's no cron: an expired trial keeps `status = 'trialing'`
  and simply computes `entitled = false` at read time.
- **Trials** are granted by `handle_new_user` (the existing `auth.users`
  insert trigger), atomically with the domains/settings seed — so a trial row
  always exists before the app can query it.
- **The webhook is the only writer** of billing state. It claims each
  `event.id` in `stripe_webhook_events` before handling, so redeliveries are
  no-ops — and releases the claim if handling fails, so Stripe's retry gets a
  real second attempt.
- `invoice.payment_failed` deliberately does **not** set `past_due` — Stripe
  retries failed invoices, and one blip shouldn't lock out a paying customer.
  `past_due` comes only from `customer.subscription.updated`'s own status.
- **Gating** lives in `src/App.tsx`: no session → `Login`; entitled → the app;
  not entitled → `LockedScreen`. A *failed* subscription check is its own
  state ("couldn't verify") and never reads as cancelled.

---

## 10. Personal friend-codes (referral — not affiliates)

Operators who already love Nuvo share a **personal code**. Friends get 20% off
their **first 3 months** at Stripe Checkout. There is **no** affiliate
marketplace, commission, or leaderboard — see D-113 / N-17.

### One Coupon, many Promotion Codes

1. Create (or re-run) the shared Coupon + named codes:

```bash
STRIPE_SECRET_KEY=sk_live_… node scripts/create-referral-codes.mjs
```

That script is idempotent. It prints `STRIPE_REFERRAL_COUPON=coup_…` and a
one-line text for each current beta operator (PHIL · ESTHER · DAVID · CHUNG).

2. Set the Supabase secret and redeploy billing functions:

```bash
supabase secrets set STRIPE_REFERRAL_COUPON=coup_xxx
supabase functions deploy stripe-checkout stripe-webhook referral-code
```

3. Apply migration `66_referral_codes` (columns on `subscriptions` for the
   operator's own code + who referred them).

4. Text each person the printed sentence. Example:

> Your friends' code is PHIL. They get 20% off their first 3 months when they
> subscribe — type it at checkout, or open https://nuvo.day/?code=PHIL.

Checkout already has **Add promotion code**. A `?code=` link is remembered
through the trial and pre-applied when they subscribe. Settings → Billing
shows **Share Nuvo** with their code once `referral-code` has minted or
attached it.

### Watching redemptions

Until volume justifies a dashboard (it doesn't):

- Stripe Dashboard → **Product catalog → Coupons** → open the Nuvo friend
  coupon → redemptions / times redeemed.
- Or SQL: `select user_id, referral_code_used, referred_by from subscriptions
  where referred_by is not null`.

If nobody redeems after a few weeks of sharing, the bottleneck isn't the
code — it's the stranger funnel (Q-05) or the product itself. Don't build an
affiliate portal to fix a silence.
