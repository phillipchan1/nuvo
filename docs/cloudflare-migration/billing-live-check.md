# Billing live check — Worker entitlement path

**Status:** pre-flip checklist · 2026-10-26  
**When:** after a preview build with `VITE_API_BASE_URL` pointing at the Worker, **before** flipping production.  
**What this is:** a live Stripe test-account and StoreKit sandbox walk-through that the SPA's paid gate reads `GET /api/entitlement` and that cancel / expire drops access.  
**What this is not:** a change to Stripe, StoreKit, Checkout, Customer Portal, IAP purchase / restore, or webhooks. Those writers stay on Supabase. This check only proves the **read**.

Sister docs: [`../cloudflare-cutover.md`](../cloudflare-cutover.md) · [`access-audit.md`](./access-audit.md) · [`../billing-setup.md`](../billing-setup.md).

---

## 0 · Do not start until

- [ ] Preview Worker is up (`https://nuvo-preview.<account>.workers.dev`) with `BETTER_AUTH_URL` set to that origin.
- [ ] Worker secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. The entitlement route SELECTs `subscriptions` by `user_id=eq.<session id>`. It does **not** need `STRIPE_SECRET_KEY`.
- [ ] The preview **SPA** was built with `VITE_API_BASE_URL` pointing at that Worker (`/api` same-origin, or the full `https://…/api`). Empty flag = today's PostgREST path; this checklist is meaningless on that build.
- [ ] Auth copy / `npm run check:entitlement-parity` is green for the accounts you will use (Better Auth `user.id` = GoTrue `auth.users.id`). A remapped id will look like a missing subscription — fail-closed, not a free unlock.
- [ ] You are **not** on production DNS. Preview only.
- [ ] Stripe / Apple webhooks still hit the existing Supabase functions. Do not retarget them for this check.

Confirm the build is on the Worker path before buying anything:

1. Sign in on preview (Better Auth email OTP or the App Review password).
2. DevTools → Network: `GET /api/entitlement` fires with `Authorization: Bearer <token.hmac>` and `credentials: include`.
3. There is **no** PostgREST `GET /rest/v1/subscriptions` from the SPA.

If (2) or (3) fails, stop. You are still on today's path.

---

## 1 · Stripe test-account (web / Mac preview)

Nuvo's production Stripe is **live mode** ([`billing-setup.md`](../billing-setup.md): there is no shipped test-mode catalog; `4242…` is declined). For this rehearsal use a **Stripe test-mode account** whose webhooks still write the same `public.subscriptions` row the Worker reads — or a 100%-off coupon on live, never a real charge on a customer you care about.

Pick one account that is **not** entitled when you start (expired trial or `cancelled`). Note its `user_id`.

| Step | Do | Expect |
|---|---|---|
| 1. Baseline | Sign in on preview. `GET /api/entitlement` | `200` `{ entitled: false, present: true, … }`. SPA shows the paywall (`LockedScreen`), not the planner, not "Couldn't verify". |
| 2. Subscribe | Open Checkout for Monthly or Annual (existing Stripe Checkout — do not change it). Complete with a test card / 100% coupon. Wait for `stripe-webhook` to write `status = active`. | Supabase `subscriptions` row for **that** `user_id` is `active`. |
| 3. Entitlement shows | Reload preview (or wait for the 5s error-interval refetch). `GET /api/entitlement` again | `200` `{ entitled: true, present: true, status: "active", plan_source: "stripe" }`. SPA opens the planner. Settings → Billing can still show writer-only Stripe fields as empty on this path — that is expected; this PR does not fetch them. |
| 4. Cancel / expire | Customer Portal → cancel, or Stripe dashboard → cancel / expire the test subscription. Wait for `customer.subscription.deleted` / `updated`. | Row is `cancelled` (or trial past `trial_ends_at`). |
| 5. Entitlement drops | Reload preview | `200` `{ entitled: false, … }`. SPA returns to the paywall. It must **not** stay open on a stale `was-entitled` hint after a successful not-entitled read — a successful `false` clears the hint. |

Fail the check if any of: subscribe succeeds in Stripe but preview stays locked; cancel succeeds in Stripe but preview stays open; preview opens the planner when `/api/entitlement` is `entitled: false`.

---

## 2 · StoreKit sandbox (iOS binary against preview)

Writers stay `apple-iap` + `apple-webhook` on Supabase. The binary under test must be a preview-flavored build (`VITE_API_BASE_URL` set, `VITE_IAP_ONLY=1`). Sandbox Apple ID, not a production App Store account.

| Step | Do | Expect |
|---|---|---|
| 1. Baseline | Sign in on the sandbox build. Confirm `GET /api/entitlement` (Charles / Proxyman / Safari Web Inspector) | `entitled: false` → `IapChooser`, not Stripe Checkout. |
| 2. Subscribe | Buy `NUVO_IAP_MONTHLY` or `NUVO_IAP_ANNUAL` in the sandbox. StoreKit confirm → `apple-iap` writes the row. | `subscriptions.status = active`, `plan_source = apple`. |
| 3. Entitlement shows | Cold-launch the app | `/api/entitlement` → `entitled: true`, `plan_source: "apple"`. Planner opens. Restore Purchases is **not** part of this check (do not change it); if you tap it, it must still hit the existing Supabase confirm. |
| 4. Expire | Sandbox subscription management → cancel, or wait out the sandbox renewal (accelerated). Apple notification → `apple-webhook`. | Row leaves `active`. |
| 5. Entitlement drops | Cold-launch | `/api/entitlement` → `entitled: false`. Paywall returns. |

A Stripe-paid account must still unlock the iOS binary (one row, two rails). After step 3 of §1, sign the **same** `user_id` into the sandbox build: entitlement shows without a second purchase. After step 5 of §1, that same binary must lock.

---

## 3 · Fail-closed (do this once, on preview)

The Worker path must not treat an outage as "not entitled" **or** as "paid".

| Step | Do | Expect |
|---|---|---|
| 1. Paid, then 503 | With an entitled account on preview, temporarily unset `SUPABASE_SERVICE_ROLE_KEY` (or return 503 from `/api/entitlement`) | SPA shows **"Couldn't verify your subscription"** if this device has no last-launch hint. A device that launched entitled yesterday may stay in the planner (`wasEntitled`) — that is the existing hint, not an unlock from the failed read. |
| 2. Hint is not truth | Sign out (clears the hint). Sign back in while entitlement is still 503 | Verify-error card. **Not** the planner. **Not** the paywall-as-cancelled. |
| 3. Restore | Put the secret back | Refetch (or the 5s interval) → entitled again, planner opens. |
| 4. Unauthenticated | Call `GET /api/entitlement` with no cookie and no Bearer | `401`. The SPA must not render the shell. |

---

## 4 · Sign-off

Record in the cutover notes (not in this file): preview URL, Stripe / sandbox account emails (not passwords), the two `GET /api/entitlement` JSON bodies (before / after cancel), and who watched the fail-closed 503.

**Go** only if every box in §0–§3 is checked and production DNS is still on today's PostgREST path.

**No-go** if a remapped auth id showed the wrong tier, if a Worker 503 opened the planner for a never-entitled device, or if cancel left `entitled: true`.
