# Billing live check — Worker entitlement path

**Status:** pre-flip checklist · 2026-10-26  
**When:** after a preview build with `VITE_API_BASE_URL` pointing at the Worker, **before** flipping production.  
**What this is:** a live walk-through that the SPA's paid gate reads `GET /api/entitlement` on the same accounts that today's PostgREST path already knows, and that cancel / expire drops access.  
**What this is not:** a change to Stripe, StoreKit, Checkout, Customer Portal, IAP purchase / restore, or webhooks. Those writers stay on Supabase. This check proves the **read**.

Sister docs: [`../cloudflare-cutover.md`](../cloudflare-cutover.md) · [`access-audit.md`](./access-audit.md) · [`../billing-setup.md`](../billing-setup.md).

> **`VITE_API_BASE_URL` is not an entitlement-only switch.** The same flag
> moves auth (Better Auth), planner CRUD, agent / MCP, and every other
> Worker API call. A "flag-on" build is a different backend for the whole
> SPA. Flip and rollback below mean **rebuild + redeploy**, not a runtime
> toggle of the paywall.

---

## 0 · Do not start until

- [ ] Preview Worker is up (`https://nuvo-preview.<account>.workers.dev`) with `BETTER_AUTH_URL` set to that origin.
- [ ] Worker secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. The entitlement route SELECTs `subscriptions` by `user_id=eq.<session id>`. It does **not** need `STRIPE_SECRET_KEY`.
- [ ] You have **two SPA builds** of the same commit: flag-off (`VITE_API_BASE_URL` empty) and flag-on (set to the Worker `/api`). You will compare them per account, not guess.
- [ ] Auth copy / `npm run check:entitlement-parity` is green for the accounts you will use (Better Auth `user.id` = GoTrue `auth.users.id`). A remapped id will look like a missing subscription — fail-closed, not a free unlock.
- [ ] You are **not** on production DNS. Preview only.
- [ ] Stripe / Apple webhooks still hit the existing (or isolated test) Supabase functions. Do not retarget production webhooks for this check.

### Isolated billing writers — no prod table, no live coupon

Nuvo's production Stripe is **live mode** ([`billing-setup.md`](../billing-setup.md)). This rehearsal must not write that table.

- [ ] Subscribe / cancel / expire only against an **isolated Stripe test-mode setup** whose webhook endpoint is a **preview or scratch Supabase**, **or** seed `subscriptions` rows on that isolated project by hand.
- [ ] **Never** point a test-mode Stripe webhook at the **production** `public.subscriptions` table.
- [ ] **Never** run a 100%-off coupon (or any charge) on the live Stripe account for this check.
- [ ] `4242…` is a test-mode card. It is declined in live mode; do not "just try it" on prod.

Confirm the flag-on build is on the Worker path before changing any row:

1. Sign in on the flag-on preview (Better Auth email OTP or the App Review password).
2. DevTools → Network: `GET /api/entitlement` fires with `Authorization: Bearer <token.hmac>` and `credentials: include`.
3. There is **no** PostgREST `GET /rest/v1/subscriptions` from the SPA.

If (2) or (3) fails, stop. You are still on today's path.

---

## 1 · Per-account tier comparison (flag-off vs flag-on)

Same commit, same `user_id`, two builds. For each account below, record both answers. They must agree on `entitled`, `plan` / `status`, `trial_ends_at`, `current_period_end`, `cancel_at_period_end`. Source does not matter (`stripe` / `apple` / null).

| Account | How to get it (isolated project only) | Flag-off (PostgREST + `isEntitled`) | Flag-on (`GET /api/entitlement`) | SPA |
|---|---|---|---|---|
| **Never-subscribed free** | No `subscriptions` row, or a row that `isEntitled` rejects and was never charged | not entitled | `present: false` or `entitled: false` | Paywall (`LockedScreen`). Not "Couldn't verify". |
| **In-window trial** | `status = trialing`, `trial_ends_at` in the future | entitled | `entitled: true`, `status: "trialing"` | Planner opens. Settings → Billing shows trial + **Ends \<date\>**. |
| **`past_due`** | `status = past_due` (Stripe `customer.subscription.updated`, isolated webhook) | not entitled | `entitled: false`, `status: "past_due"` | Paywall. Not the planner, not verify-error. |
| **Active (subscribe)** | Isolated test-mode Checkout or a seeded `status = active` row | entitled | `entitled: true`, `status: "active"`, `current_period_end` set | Planner. Billing shows **Renews \<date\>** (or **Ends \<date\>** + **Resume subscription** when `cancel_at_period_end`). |
| **Cancelled / expired** | Isolated portal cancel, or `status = cancelled`, or trial past `trial_ends_at` | not entitled | `entitled: false` | Paywall. A successful `false` clears the `was-entitled` hint. |

Fail the comparison if any account disagrees across the two builds, or if flag-on opens the planner when `entitled` is false.

---

## 2 · Stripe test-mode (web / Mac, isolated project)

Use the **never-subscribed** or **expired-trial** account from §1 as the starting point. Writers stay `stripe-checkout` / `stripe-portal` / `stripe-webhook` on the **isolated** Supabase. Do not change those functions.

| Step | Do | Expect (flag-on) |
|---|---|---|
| 1. Baseline | Sign in. `GET /api/entitlement` | `200` `{ entitled: false, … }`. Paywall. |
| 2. Subscribe | Isolated test-mode Checkout (test card). Wait for the isolated webhook to write `status = active`. | Isolated `subscriptions` row for **that** `user_id` is `active`. |
| 3. Entitlement shows | Reload. Compare to the flag-off build of the same account | Both entitled. Flag-on body includes `current_period_end`. Billing: **Renews \<date\>**. |
| 4. Cancel | Isolated Customer Portal → cancel at period end (or expire). Wait for `updated` / `deleted`. | `cancel_at_period_end: true` still entitled until the period ends; then `cancelled` / not entitled. |
| 5. Billing chrome | While `cancel_at_period_end` is true and the period has not ended | **Ends \<date\> — you'll keep access until then** and **Resume subscription**. |
| 6. Entitlement drops | After expire / `cancelled`. Reload both builds | Both not entitled. Paywall. |

---

## 3 · StoreKit sandbox (iOS binary against preview)

Writers stay `apple-iap` + `apple-webhook` on the isolated / preview Supabase. The binary under test must be flag-on (`VITE_API_BASE_URL` set, `VITE_IAP_ONLY=1`). Sandbox Apple ID, not a production App Store account.

| Step | Do | Expect |
|---|---|---|
| 1. Baseline | Sign in. Confirm `GET /api/entitlement` | `entitled: false` → `IapChooser`, not Stripe Checkout. |
| 2. Subscribe | Buy `NUVO_IAP_MONTHLY` or `NUVO_IAP_ANNUAL` in the sandbox. | `status = active`, `plan_source = apple`. |
| 3. Entitlement shows | Cold-launch. Compare to flag-off | Both entitled. `current_period_end` present when the row has it. Restore Purchases is **not** part of this check (do not change it). |
| 4. Expire | Sandbox manage → cancel, or wait out the accelerated renewal. | Row leaves `active`. |
| 5. Entitlement drops | Cold-launch both builds | Both not entitled. Paywall. |

A Stripe-paid account on the isolated project must still unlock the iOS binary (one row, two rails). After §2 step 3, sign the **same** `user_id` into the sandbox build: entitlement shows without a second purchase. After §2 step 6, that same binary must lock.

---

## 4 · Fail-closed (do this once, on preview)

The Worker path must not treat an outage as "not entitled" **or** as "paid".

| Step | Do | Expect |
|---|---|---|
| 1. Paid, then 503 | With an entitled account on flag-on, temporarily unset `SUPABASE_SERVICE_ROLE_KEY` (or return 503 from `/api/entitlement`) | **"Couldn't verify your subscription"** if this device has no last-launch hint. A device that launched entitled yesterday may stay in the planner (`wasEntitled`) — that is the existing hint, not an unlock from the failed read. |
| 2. Hint is not truth | Sign out (clears the hint). Sign back in while entitlement is still 503 | Verify-error card. **Not** the planner. **Not** the paywall-as-cancelled. |
| 3. Restore | Put the secret back | Refetch (or the 5s interval) → entitled again, planner opens. |
| 4. Unauthenticated | `GET /api/entitlement` with no cookie and no Bearer | `401`. The SPA must not render the shell. |

---

## 5 · Flip and rollback

These are **rebuilds**. The flag moves auth and every other API call, not just the paywall.

### Flip (preview first; production only after sign-off)

1. Build the SPA with `VITE_API_BASE_URL` set to the Worker (`/api` same-origin, or `https://<worker>/api`).
2. Deploy that build to preview. Confirm §0 steps 1–3 (Worker GET, no PostgREST subscriptions select).
3. Re-run §1 on the preview URL for the four account shapes (never-subscribed, in-window trial, `past_due`, active → cancelled).
4. Production flip is the same rebuild + deploy, plus DNS / hosting cutover in [`../cloudflare-cutover.md`](../cloudflare-cutover.md). Do **not** retarget Stripe or Apple webhooks as part of this flip.

### Rollback

1. Rebuild the SPA with `VITE_API_BASE_URL` **empty** (unset). That is the rollback — today's GoTrue + PostgREST path, including the subscription select.
2. Redeploy that build over the flag-on URL you flipped.
3. Confirm DevTools: `GET /rest/v1/subscriptions` is back; there is no `GET /api/entitlement`.
4. Re-check one entitled and one free account. They must match what flag-off showed in §1.
5. Leave Stripe / Apple webhooks where they were. Rollback does not move writers.

A flag-on build that you "only" point at `/functions/v1` is **not** a billing rollback — auth and planner CRUD move with the same variable.

---

## 6 · Known gap — friend-codes / share block

`referral-code` needs a GoTrue JWT and writes a Stripe Promotion Code. It is **not** ported. On a flag-on build, Settings → Billing **hides the minting share block** and shows a short message; it must **not** call `referral-code` (no repeated failing invokes).

- [ ] Flag-on Billing: share block is the unavailable message, Network has no `referral-code` invoke.
- [ ] Flag-off Billing: share block still mints / shows the code as today.
- [ ] `GET /api/entitlement` may still return `referral_code` / `referral_uses` / `referral_credits_earned` for a row that already has them. Display-only; no mint.

Do not treat a missing share code on flag-on as a flip blocker. It is this gap.

---

## 7 · Sign-off

Record in the cutover notes (not in this file): preview URLs for **both** builds, isolated Stripe / sandbox account emails (not passwords), the §1 comparison table, the two `GET /api/entitlement` JSON bodies (before / after cancel), who watched the fail-closed 503, and that rollback (empty `VITE_API_BASE_URL`) was rehearsed once.

**Go** only if every box in §0–§6 is checked (gap in §6 acknowledged) and production DNS is still on today's path until the signed-off flip.

**No-go** if a remapped auth id showed the wrong tier, if a Worker 503 opened the planner for a never-entitled device, if cancel left `entitled: true`, if flag-off and flag-on disagreed for any §1 account, or if a test-mode webhook was aimed at production `subscriptions`.
