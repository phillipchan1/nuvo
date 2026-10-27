# Billing live check — Worker proxy + entitlement

**Status:** pre-flip checklist · 2026-10-27  
**When:** after a preview Worker that serves the billing proxy, **before** flipping production (`CUTOVER_FLIPPED` / DNS).  
**What this is:** a live walk-through that an Apple sandbox purchase and a Stripe **TEST** checkout **through the Worker** each write a Supabase `subscriptions` row the app can see (`GET /api/entitlement` → planner unlocks).  
**What this is not:** a change to Stripe prices, StoreKit product ids, or webhook signatures. Writers stay the existing Supabase functions. Stripe stays in **TEST** mode. Do not touch live keys.

Sister docs: [`../cloudflare-cutover.md`](../cloudflare-cutover.md) · [`access-audit.md`](./access-audit.md) · [`../billing-setup.md`](../billing-setup.md).

> **Entitlement writes stay on Supabase (option b).** `subscriptions` /
> webhook ledgers are exempt from `freeze.sql`. The Worker SELECTs those
> rows. We did not repoint billing to Neon.

> Auth ids are copied 1:1 (`auth.users.id` = Better Auth `"user".id`). A
> remapped id looks like a missing subscription — fail-closed.

---

## 0 · Do not start until

- [ ] Preview Worker is up with `BETTER_AUTH_URL` set to that origin.
- [ ] Worker secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. The proxy uses them as the service-role bearer + `X-Nuvo-Acting-User`. `GET /api/entitlement` SELECTs `subscriptions` by `user_id=eq.<session id>`. It does **not** need `STRIPE_SECRET_KEY`.
- [ ] You have a **flag-on** SPA of this commit (`VITE_API_BASE_URL` → the Worker `/api`, or — once #117 lands — a binary that will flip when `cutover_flipped` is true). Billing calls must go through the Worker for this check. A flag-off build talking straight to Supabase does **not** prove the proxy.
- [ ] Auth copy / `npm run check:entitlement-parity` is green for the accounts you will use.
- [ ] You are **not** on production DNS. Preview only.
- [ ] Stripe is **TEST** mode. The TEST webhook endpoint is a **preview or scratch Supabase**. Do not retarget production webhooks. Do not use live keys.
- [ ] Apple is a **sandbox** Apple ID, `VITE_IAP_ONLY=1` binary, talking to the same preview Worker.

Confirm the flag-on build is on the Worker path before buying anything:

1. Sign in on the flag-on preview (Better Auth email OTP or the App Review password).
2. DevTools → Network: `GET /api/entitlement` fires with `Authorization: Bearer <token.hmac>` and `credentials: include`.
3. There is **no** PostgREST `GET /rest/v1/subscriptions` from the SPA.
4. Open Settings → Billing (web) or the IAP chooser (iOS). Do **not** subscribe yet.

If (2), (3), or (4) fails, stop. You are still on today's path.

---

## 1 · Stripe TEST checkout through the Worker (web / Mac)

Use a **never-subscribed** or **expired-trial** account that already has a `subscriptions` row (the 14-day trial from signup). Isolated Stripe **TEST** only. Test card `4242…`.

| Step | Do | Expect |
|---|---|---|
| 1. Baseline | Sign in. `GET /api/entitlement` | `200` `{ entitled: false, … }`. Paywall / LockedScreen. |
| 2. Start checkout | Settings → Billing → subscribe monthly or annual. | Network: `POST https://<worker>/api/stripe-checkout` (or `/functions/v1/stripe-checkout`) with the Better Auth bearer. **Not** `*.supabase.co/functions/v1/stripe-checkout` from the browser. Response `{ url }` to Stripe TEST Checkout. |
| 3. Pay | Complete TEST Checkout (`4242…`). Wait for the isolated `stripe-webhook` to write `status = active`. | Isolated `subscriptions` row for **that** `user_id` is `active`, `plan_source = stripe`. |
| 4. Visible in the app | Reload the flag-on SPA. | `GET /api/entitlement` → `entitled: true`, `status: "active"`, `current_period_end` set. Planner opens. Billing shows **Renews \<date\>**. This is the gate — a row in the table that the paywall still blocks is a fail. |
| 5. Cancel (optional) | Isolated Customer Portal → cancel at period end. | `cancel_at_period_end: true` still entitled until the period ends; Billing shows **Ends \<date\>**. |

**Fail** if the browser called Supabase `stripe-checkout` directly, if Checkout charged **live** mode, if entitlement stayed `false` after the webhook, or if the planner did not open.

---

## 2 · Apple sandbox purchase through the Worker (iOS)

Sandbox Apple ID. Flag-on iOS binary (`VITE_API_BASE_URL` set, `VITE_IAP_ONLY=1`). Same isolated Supabase `subscriptions` table the Worker reads.

| Step | Do | Expect |
|---|---|---|
| 1. Baseline | Sign in. Confirm `GET /api/entitlement` | `entitled: false` → `IapChooser`, not Stripe Checkout. |
| 2. Subscribe | Buy `NUVO_IAP_MONTHLY` or `NUVO_IAP_ANNUAL` in the sandbox. | StoreKit purchase options include `appAccountToken` = this account's Nuvo user id (UUID). After the sheet, Network: `POST https://<worker>/api/apple-iap` with the Better Auth bearer. **Not** a GoTrue JWT to `*.supabase.co`. |
| 3. Visible in the app | Cold-launch. | `GET /api/entitlement` → `entitled: true`, `plan_source = apple`. Planner opens. Restore Purchases on a second device (same Apple ID + same Nuvo account) also confirms through `/api/apple-iap` and stays entitled. |
| 4. New-buyer webhook | On a **second** never-subscribed sandbox account: buy, then **kill the app before confirm** (or drop the confirm request). Wait for `apple-webhook`. | The notification's `appAccountToken` maps to that user. Isolated row becomes `active`. Cold-launch: entitled, planner opens. This is the case confirm used to 401 after the flip. |
| 5. Expire (optional) | Sandbox manage → cancel, or wait out the accelerated renewal. Cold-launch. | Not entitled. Paywall. |

A Stripe-TEST-paid account on the isolated project must still unlock the iOS binary (one row, two rails). After §1 step 4, sign the **same** `user_id` into the sandbox build: entitlement shows without a second purchase.

**Fail** if confirm went to Supabase with a GoTrue JWT (it will 401 after the flip), if `appAccountToken` was missing, if entitlement stayed `false`, or if the planner did not open.

---

## 3 · Fail-closed (do this once, on preview)

| Step | Do | Expect |
|---|---|---|
| 1. Paid, then 503 | With an entitled account on flag-on, temporarily unset `SUPABASE_SERVICE_ROLE_KEY` (or return 503 from `/api/entitlement`) | **"Couldn't verify your subscription"** if this device has no last-launch hint. A device that launched entitled yesterday may stay in the planner (`wasEntitled`) — that is the existing hint, not an unlock from the failed read. |
| 2. Hint is not truth | Sign out (clears the hint). Sign back in while entitlement is still 503 | Verify-error card. **Not** the planner. **Not** the paywall-as-cancelled. |
| 3. Restore | Put the secret back | Refetch → entitled again, planner opens. |
| 4. Unauthenticated | `GET /api/entitlement` and `POST /api/stripe-checkout` with no cookie and no Bearer | both `401`. The SPA must not render the shell. The proxy must not call Supabase. |

---

## 4 · Friend-codes

`referral-code` is proxied the same way as checkout. Settings → Billing **Share Nuvo** mints through `POST /api/referral-code`.

- [ ] Flag-on Billing: share block calls the Worker; Network has `POST /api/referral-code` (or `/functions/v1/referral-code`), not a failing Supabase invoke.
- [ ] Flag-off Billing (no Worker URL): share block still mints on today's path.

---

## 5 · Flip and rollback

These are **rebuilds** (or, once #117 lands, a launch-time `cutover_flipped` switch). The flag moves auth and every other API call, not just the paywall.

### Flip (preview first; production only after sign-off)

1. Build the SPA with `VITE_API_BASE_URL` set to the Worker (`/api` same-origin, or `https://<worker>/api`).
2. Deploy that build to preview. Confirm §0 (Worker GET, no PostgREST subscriptions select, billing POSTs hit `/api/<name>`).
3. Re-run §1 and §2. Both must leave the planner entitled.
4. Production flip is the same path, plus the cutover runbook in [`../cloudflare-cutover.md`](../cloudflare-cutover.md). Do **not** retarget Stripe or Apple webhooks. Do **not** switch Stripe to live for this rehearsal.

### Rollback

1. Rebuild with `VITE_API_BASE_URL` **empty** (or clear `cutover_flipped` once #117 lands). Today's GoTrue + PostgREST path, including `functions.invoke` straight to Supabase.
2. Confirm DevTools: `GET /rest/v1/subscriptions` is back; billing POSTs hit `*.supabase.co/functions/v1/<name>`.
3. Re-check one entitled and one free account.
4. Leave Stripe / Apple webhooks where they were.

---

## 6 · Sign-off

Record in the cutover notes (not in this file): preview URLs, isolated Stripe TEST / sandbox account emails (not passwords), the two `GET /api/entitlement` JSON bodies (before / after each purchase), the Network URLs for `stripe-checkout` and `apple-iap` (must be the Worker), who watched the planner unlock, and that rollback was rehearsed once.

**Go** only if §0–§5 are checked and production DNS is still on today's path until the signed-off flip.

**No-go** if a remapped auth id showed the wrong tier, if a Worker 503 opened the planner for a never-entitled device, if a TEST webhook was aimed at production `subscriptions`, if a live Stripe key was used, if confirm/checkout still hit Supabase from the browser, or if a successful purchase left the paywall up.
