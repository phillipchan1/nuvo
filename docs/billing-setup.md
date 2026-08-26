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
- Events to send — select exactly these **six**:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `invoice.paid` ← required for friend-code **referrer credits**
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

- **One row, two rails.** Web pays with Stripe Checkout + Customer Portal.
  The iOS App Store binary pays with StoreKit auto-renewable IAP only — no
  Stripe UI, no web prices, no "cheaper on the web." Both write the same
  `subscriptions` row: `plan` (computed alias of `status`: trialing | active |
  cancelled | past_due) + `plan_source` (`stripe` | `apple`). iOS signup
  unlocks web; web signup unlocks iOS.
- **Entitlement** is one function, `isEntitled` in
  `supabase/functions/_shared/planRules.ts`. SQL twins: `entitled(subscriptions)`
  and `is_entitled(subscriptions)`. Active, or trialing with a future
  `trial_ends_at`. `past_due` is not entitled. Source does not matter.
- **One updater.** Stripe's webhook and Apple's (StoreKit verify + App Store
  Server Notifications V2) both call `applyPlanUpdate`. The unused rail cannot
  demote an active row on the other rail.
- **One trial, both rails.** `handle_new_user` inserts the `subscriptions`
  row with `status = 'trialing'` and `trial_ends_at = now() + 14 days`.
  That is the trial — app-side, no card, not Stripe Checkout, not a StoreKit
  introductory offer. iOS signup uses this same row. There is no second trial
  table. An Apple intro offer, if Marketing adds one, lives in App Store
  Connect when they create SKUs (after listing screenshots; no Submit).
  `plan_source` stays null until a rail is charged.
- **The webhook is the only writer** of billing state (plus the authenticated
  `apple-iap` confirm after a StoreKit purchase). Stripe claims each
  `event.id` in `stripe_webhook_events`; Apple claims `notificationUUID` in
  `apple_webhook_events`. Redeliveries are no-ops; a failed handle releases
  the claim so the retry is real.
- `invoice.payment_failed` deliberately does **not** set `past_due` — Stripe
  retries failed invoices, and one blip shouldn't lock out a paying customer.
  `past_due` comes only from `customer.subscription.updated`'s own status.
- **Gating** lives in `src/App.tsx`: no session → `Login`; entitled → the app;
  not entitled → `LockedScreen` (Stripe `PlanChooser` on web/macOS, StoreKit
  `IapChooser` on the iOS binary). A *failed* subscription check is its own
  state ("couldn't verify") and never reads as cancelled.

---

## 11. iOS App Store IAP (StoreKit)

**Status: SKUs exist in App Store Connect — not submitted.** No intro offer.
Trial stays app-side (`handle_new_user` / `trial_ends_at`). Prices in the
iOS UI come only from StoreKit product objects. Web Stripe copy in
`plans.ts` stays $29/month and $228/year.

**Subscription group:** Nuvo Pro · id `22327993`

| SKU | Env (product identifier) | Apple ID | Connect price / period |
|---|---|---|---|
| Monthly | `NUVO_IAP_MONTHLY` | `6804259519` | $29.99 / 1 month |
| Annual | `NUVO_IAP_ANNUAL` | `6804258767` | $229.99 / 1 year |

The StoreKit Product ID strings **are** `NUVO_IAP_MONTHLY` and
`NUVO_IAP_ANNUAL`. Those are what `product()` asks StoreKit for. The `6804…`
values are Apple internal IDs only — never pass them to `product()`. Env
may repeat the same strings; a numeric override is ignored.

The iOS binary (`tauri ios build`, `TAURI_ENV_PLATFORM=ios`) sets
`VITE_IAP_ONLY=1` so Stripe checkout, the portal, and `plans.ts` web prices
are tree-shaken out of the IPA. `tauri ios dev` still uses `isTauriIOS()` so
Subscribe never opens Stripe. If StoreKit products are missing, the paywall
is a stub — it never falls back to Stripe. iOS signup is already entitled
for 14 days via the same `handle_new_user` row; this plugin is for paying
after that trial, not a second trial.

The expired-trial lock screen is `IapChooser`. Each SKU shows StoreKit's
title, duration, and `displayPrice`. Terms (`https://nuvo.day/terms`) and
Privacy (`https://nuvo.day/privacy`) sit on the paywall. Restore Purchases
is on the paywall and in Settings → Billing.

### Env (Supabase secrets + optional Vite)

```bash
# Product ID strings (not Apple IDs 6804259519 / 6804258767, not prices).
# Group Nuvo Pro 22327993.
supabase secrets set \
  NUVO_IAP_MONTHLY=NUVO_IAP_MONTHLY \
  NUVO_IAP_ANNUAL=NUVO_IAP_ANNUAL \
  APPLE_BUNDLE_ID=day.nuvo.app \
  APPLE_IAP_ENVIRONMENT=Sandbox \
  APPLE_NOTIFICATION_SECRET=long-random
```

| Var | Where | What |
|---|---|---|
| `NUVO_IAP_MONTHLY` | Supabase | StoreKit Product ID for Apple ID `6804259519`. **Not** the Apple ID, **not** a price. |
| `NUVO_IAP_ANNUAL` | Supabase | StoreKit Product ID for Apple ID `6804258767`. **Not** the Apple ID, **not** a price. |
| `VITE_NUVO_IAP_MONTHLY` / `VITE_NUVO_IAP_ANNUAL` | iOS Vite build (optional) | Same Product ID strings baked into the binary so StoreKit can be queried offline. |
| `APPLE_BUNDLE_ID` | Supabase | Must match the transaction's `bundleId` (`day.nuvo.app`). |
| `APPLE_IAP_ENVIRONMENT` | Supabase | `Sandbox` or `Production`. Record-keeping; notifications carry their own environment. |
| `APPLE_NOTIFICATION_SECRET` | Supabase | Optional query secret on the App Store Server Notifications URL. |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` | Supabase | Unchanged. Web only. |

Do **not** put dollar amounts in these values. Localized prices exist only on
StoreKit product objects at runtime.

### Functions to deploy

```bash
supabase functions deploy stripe-checkout stripe-portal stripe-webhook apple-iap apple-webhook iap-catalog
```

`apple-webhook` is `verify_jwt = false`. Point App Store Connect → App Store
Server Notifications V2 at:

`https://<project>.supabase.co/functions/v1/apple-webhook?secret=<APPLE_NOTIFICATION_SECRET>`

Migration `71_plan_source` adds `plan_source`, Apple transaction columns, the
`plan` / `is_entitled` computed columns, and `apple_webhook_events`. Do **not**
apply it from this PR. Master's migration 70 is `delete_secret` (account
deletion) — leave it alone. No `supabase db push`, no deploy of 71.

SKUs are already in Connect (not submitted). Do not write $29.99 / $229.99
into the binary. Do not Submit the app from this PR. Dayspring Stripe
catalog untouched.

---

## 10. Personal friend-codes — launch runbook (for Grokbot)

**Offer (D-113):**

| Side | What |
|---|---|
| Friend | **50% off first invoice** (Stripe Coupon `duration: once`) |
| Sharer | **One free month** ($29 Customer Balance credit) when the friend **pays** — not on trial start |
| Cap | **6 months** of outstanding credit on the sharer's Stripe customer |
| Hands-off | New operators mint a unique `NAME-XXXX` code in Settings → Billing. No apply form. Explainer: `/share`. No `/affiliates` portal. |

Project ref: `ebibzojtkzkphykznomv`. Point people at https://nuvo.day/share.

### A. Stripe coupon + seed codes (once)

```bash
cd /path/to/nuvo
STRIPE_SECRET_KEY=sk_live_… node scripts/create-referral-codes.mjs
```

The script is idempotent. It prints `STRIPE_REFERRAL_COUPON=coup_…` and texts
for early bare-name seeds (PHIL · ESTHER · DAVID · CHUNG). New accounts get
`NAME-XXXX` via the `referral-code` function — never a bare first name.
Paste seed texts, or point everyone at https://nuvo.day/share.

### B. Supabase secret + functions

```bash
supabase secrets set STRIPE_REFERRAL_COUPON=coup_xxx --project-ref ebibzojtkzkphykznomv
supabase functions deploy stripe-checkout stripe-webhook referral-code --project-ref ebibzojtkzkphykznomv
```

Migrations `66_referral_codes` and `67_referral_reward` must be applied
(`supabase db push` or the dashboard). Columns: `referral_code`,
`stripe_promotion_code_id`, `referred_by`, `referral_code_used`,
`referral_reward_granted_at`.

### C. Webhook event (easy to miss)

Stripe Dashboard → **Developers → Webhooks** → the Nuvo endpoint →
**Add events** → enable **`invoice.paid`** (in addition to the five billing
events from §3). Without it, friends still get the discount; sharers never
get the free-month credit.

### D. After launch — zero ops

- Codes: Settings → Billing → **Share Nuvo** (auto, unique `NAME-XXXX`).
- Links: `https://nuvo.day/?code=CODE` or `https://app.nuvo.day/?code=CODE`.
- Explainer: https://nuvo.day/share
- When a friend pays: referrer gets −$29 Customer Balance, a Billing line, an in-app toast,
  a web push (if enabled), and an email **if** `RESEND_API_KEY` is set
  (`RESEND_FROM` optional, defaults to `Nuvo <hello@nuvo.day>`).
- Watch: Stripe → Coupons → redemptions; or
  `select user_id, referral_credits_earned, referred_by, referral_reward_granted_at from subscriptions where referral_credits_earned > 0 or referred_by is not null`.

### E. Smoke check

1. Open Settings → Billing — a unique code appears (or "not configured" until B).
2. Incognito: `https://nuvo.day/?code=…` → Start free → subscribe → first invoice ~50%.
3. Sharer's Stripe customer shows a **−$29** balance; Billing says they've earned a free month.
