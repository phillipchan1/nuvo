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
  (after the Cloudflare cutover: `https://api.nuvo.day/api/stripe-webhook`, changed in place — see
  [`cloudflare-cutover.md` → Billing port](./cloudflare-cutover.md#billing-port))
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
  `apple-iap` confirm after a StoreKit purchase — which trusts **only** an App
  Store JWS verified to Apple Root CA - G3, never the ids/expiry in the body;
  see *The `apple-iap` confirm* below). Stripe claims each
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

**The TestFlight build must carry them.** Vite bakes only the `VITE_*` vars
that exist when the bundle is built, so the "Build signed IPA" step of
`.github/workflows/ios-release.yml` sets `VITE_NUVO_IAP_MONTHLY` and
`VITE_NUVO_IAP_ANNUAL` as plain values — they are public identifiers, not
secrets. `configuredIapProductIds()` falls back to the same two strings so a
workflow that forgets them still ships a real catalog rather than the "not
available from the App Store on this build yet" stub, but the fallback is the
net and the workflow is the contract; `tests/iap-catalog-env.test.ts` holds
both. A build that reaches StoreKit and *still* gets nothing back is a Connect
question (SKU state in the subscription group), not a build one.

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
| `VITE_NUVO_IAP_MONTHLY` / `VITE_NUVO_IAP_ANNUAL` | iOS Vite build — **CI must set them** | Same Product ID strings baked into the binary so StoreKit can be queried offline. Plain values, **not** GitHub secrets: they are public identifiers. |
| `APPLE_BUNDLE_ID` | Supabase **and** Worker | Must match the transaction's `bundleId`: `day.nuvo.app` (iOS, `src-tauri/tauri.ios.conf.json`). `com.nuvo.app` is the macOS app, which makes no App Store purchases — not a mismatch, and never this value. |
| `APPLE_IAP_ENVIRONMENT` | Supabase | `Sandbox` or `Production`. Record-keeping; notifications carry their own environment. |
| `APPLE_NOTIFICATION_SECRET` | Supabase (set on prod 2026-11-09, D-185) **and** Worker | Query secret on the App Store Server Notifications URL, checked **first** (401 on mismatch). An extra layer on top of the JWS verification, not a replacement for it. |
| `APPLE_IAP_KEY_ID` / `APPLE_IAP_ISSUER_ID` / `APPLE_IAP_PRIVATE_KEY` | Supabase secrets **and** Worker secrets | App Store Connect → Users and Access → Integrations → **In-App Purchase** key (`.p8` PEM; literal `\n` is fine). Only used to verify confirms from iOS **1.1** binaries, which send no JWS. All three or none — unset, a 1.1 confirm gets a retriable 503 (fail closed). |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` | Supabase | Unchanged. Web only. |

Do **not** put dollar amounts in these values. Localized prices exist only on
StoreKit product objects at runtime.

`APPLE_BUNDLE_ID` is now **required** by `apple-iap` and `apple-webhook`, on
both Supabase and the Worker: unset, every confirm and every
notification is refused (503, so Apple keeps retrying until it is set). It is `day.nuvo.app` — the App Store
bundle, which is what Apple signs into the transaction.

### The `apple-iap` confirm

Both runtimes run one decision, `confirmAppleTransaction`
(`supabase/functions/_shared/appleIap.ts`), over one verifier
(`_shared/appleJws.ts`, which the Worker re-exports):

1. **iOS 1.2+** sends StoreKit 2's `jwsRepresentation`. **iOS 1.1** sends only
   ids, so the server fetches the transaction by `transactionId` from the App
   Store Server API (production, then sandbox) and verifies Apple's
   `signedTransactionInfo` the same way. No JWS and no API key → 503.
2. productId, expiry, bundle, environment, ids, appAccountToken and
   revocation come only from the verified payload. Refused (4xx, no write):
   wrong bundle, product not in the catalog, revoked, expired,
   appAccountToken ≠ the signed-in user, or a lineage already linked to
   another account. A token-less (1.1) purchase is accepted only on a lineage
   nobody holds yet.
   **An account paying on Stripe is refused 409 `active_on_other_rail`**
   (`activeOnStripe`: `plan_source` stripe, or a Stripe subscription id, and
   `active`/`trialing`). A confirm never flips the rail — that is how a free
   sandbox purchase used to turn a paying Stripe customer into an Apple row
   whose later EXPIRED cancelled them (QA2 #136 S2). A lapsed Stripe row may
   be taken over.
3. **Sandbox is accepted** for any account (App Review and TestFlight buy
   with sandbox receipts against production; no allowlist — D-185 ruling (a))
   and recorded as `apple_environment`. **A sandbox row is entitled only
   until its `current_period_end`** (ruling (b), below).
4. Any verification error — bad chain, wrong root, bad signature, Apple
   unreachable — fails closed.
5. Every refusal logs **one single-line JSON** — `{"event":"apple_iap_verify",
   "outcome":"rejected","code":"…","status":…,"runtime":"supabase"|"worker"}`
   (`iapVerifyLogLine`), codes only, never an id. **Alert on repeated
   `"code":"apple_unreachable"`**: a missing, wrong or revoked `APPLE_IAP_*`
   key makes every 1.1 confirm one, forever, and the client only ever sees
   "try again" (QA2 #136 S7).

### Sandbox entitlement ends at the verified period end (ruling (b))

`isEntitled` (`_shared/planRules.ts` — the SPA and the Worker) and its SQL
twin `public.entitled` (migration `00000000000093_sandbox_entitlement_period.sql`)
treat a row with `plan_source = 'apple'` **and** `apple_environment =
'sandbox'` as entitled only while `current_period_end > now()`; a missing
period end is not entitled. For an Apple row that column is written only
from a verified transaction (the confirm, the JWS-verified webhook).
**Production rows and rows with no recorded environment are not held to the
period end** — notifications don't reliably reach us yet, and a real payer
must never be cut off by a renewal we didn't hear about. `tests/sandbox-entitlement.test.ts`
holds the TS rule, the Worker's read and the SQL function to the same cases.

### Known limits (documented, not fixed)

- **S3 — a tokenless (1.1) lineage goes to whoever confirms it first.** A 1.1
  purchase carries no `appAccountToken`, so an unlinked lineage (e.g. one
  whose confirm failed before `APPLE_IAP_*` was set) links to the first Nuvo
  account that confirms its JWS or `transactionId`. Needs that JWS or id;
  low likelihood. Mitigation: set `APPLE_IAP_*` before deploying `apple-iap`.
- **S6 — Family Sharing members get 403 on restore.** A family member's
  transaction carries the purchaser's `appAccountToken`, so their confirm is
  `account_mismatch`. Fine while Family Sharing is off for `NUVO_IAP_*`;
  turning it on needs a decision on how members get access.

`apple_status` / `apple_expires_at` stay unwritten on purpose: no webhook
maintains them, and `entitled()` ORs them in — an `apple-iap`-written
`apple_status = 'active'` would outlive a REFUND that only flips `status`.

### The `apple-webhook` (App Store Server Notifications V2)

`supabase/functions/apple-webhook` is a thin shell over
`handleAppleNotification` (`supabase/functions/_shared/appleWebhook.ts`,
tested by `tests/apple-webhook-verify.test.ts`):

1. `?secret=` must match `APPLE_NOTIFICATION_SECRET` when that is set (401).
2. The outer `signedPayload`, the nested `data.signedTransactionInfo` and,
   when present, `data.signedRenewalInfo` are each verified with
   `verifyAppleJws` (Apple Root CA - G3 pin). Unsigned, malformed, wrong root,
   bad chain or bad signature on **any** of them → 400, no write, no ledger
   claim.
3. `data.bundleId` and the transaction's `bundleId` must equal
   `APPLE_BUNDLE_ID` → else 400 `wrong_bundle` (a 4xx, not a silent 200, so a
   mistyped `APPLE_BUNDLE_ID` — e.g. the macOS id `com.nuvo.app` — is loud
   and Apple's retries survive the fix).
4. Sandbox and Production are both accepted. The envelope's, the
   transaction's and the renewal info's environments must agree (else 400),
   and the row records `apple_environment` = `production` | `sandbox`.
5. Plan, `current_period_end`, `cancel_at_period_end`, product and lineage
   come only from the verified notification type/subtype and transaction.
   A transaction with `revocationDate` is never `active`. Products outside the
   catalog, unmapped types (`TEST`, …) and notifications with no transaction
   are acked 200 with no write.
6. The row is matched by `originalTransactionId` only — never by
   `appAccountToken`, never moved between accounts. `apple-iap` links it.
7. The ledger claim (`apple_webhook_events`, keyed by `notificationUUID`) and
   the row write are **one transaction**: `public.apple_webhook_apply`
   (migration `00000000000092_apple_webhook_apply.sql`, service role only).
   The function computes the patch with the kernel's `planRowPatch` against
   the row it read; the RPC applies it only if the row is unchanged, else it
   raises. A replayed UUID → 200 `duplicate`, no second write. Any DB error →
   generic 500 and the claim rolls back, so Apple's retry is processed.

Status codes: 401 secret · 400 unverified / wrong bundle / environment ·
503 `APPLE_BUNDLE_ID` unset · 200 applied / ignored / duplicate · 500 DB
error (retriable). Refusal bodies are fixed strings — `{"error":"rejected"}`
(400) or `{"error":"unavailable"}` (503); the verifier's message and the code
never reach the caller (QA2 #136 S5). The code goes to one JSON log line,
`{"event":"apple_webhook_verify","outcome":"rejected","code":"…",…}`.
`sync_log` is written only after the transaction (never inside it: a failed
log INSERT would abort the write — S4).

**The Worker's `/api/apple-webhook` runs the same `decideAppleNotification`**
(same statuses, same bodies). It differs only in the write: inside one
`sql.begin` it claims the ledger and, for a lineage no row holds yet, may
attach it to the verified `appAccountToken`'s account — only if that account
has no Apple lineage and isn't paying on Stripe (`appleTokenMayAttach`).
Its `sync_log` lines are collected and written after the commit.

### Functions to deploy

**Order is load-bearing:** apply migration `00000000000092_apple_webhook_apply`
**before** deploying `apple-webhook`. The new function calls
`apple_webhook_apply` for every write; without it every write 500s (Apple
retries for ~3 days, so nothing is lost if the migration follows quickly,
but don't rely on it). Set `APPLE_BUNDLE_ID=day.nuvo.app` before the deploy
too, or every notification answers 503. Migration
`00000000000093_sandbox_entitlement_period` (ruling (b)) is independent of
the functions and can go in the same push; the SPA's and the Worker's
`isEntitled` enforce the same rule without it.

Full order: (1) secrets — `APPLE_BUNDLE_ID`, `APPLE_IAP_*`,
`APPLE_NOTIFICATION_SECRET` (set) · (2) `supabase db push` (92, 93) ·
(3) `supabase functions deploy apple-iap apple-webhook` · (4) Worker: the
same secrets as wrangler secrets before the flip.

```bash
supabase db push   # includes 00000000000092_apple_webhook_apply — Phil's call, not from a PR
supabase functions deploy stripe-checkout stripe-portal stripe-webhook apple-iap apple-webhook iap-catalog
```

`apple-webhook` is `verify_jwt = false`. Point App Store Connect → App Store
Server Notifications V2 at:

`https://<project>.supabase.co/functions/v1/apple-webhook?secret=<APPLE_NOTIFICATION_SECRET>`

Migration `71_plan_source` adds `plan_source`, Apple transaction columns, the
`plan` / `is_entitled` computed columns, and `apple_webhook_events`. Do **not**
apply it from this PR. Master's migration 70 is `delete_secret` (account
deletion) — leave it alone. No `supabase db push`, no deploy of 71.
*(Historical. plan_source is now 75; production's 70 turned out to be an
uncommitted `apple_billing`, now committed as 70, and delete_secret is 88.)*

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
