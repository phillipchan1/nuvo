# App Store Review — sign-in & listing notes

**Status: built 2026-09-08 (code).** The iOS login screen offers **email +
password** (`signInWithPassword`) so a reviewer can enter the demo account
without waiting for an OTP. Apple and Google stay (Guideline **4.8**). Account
deletion is unchanged (Guideline **5.1.1(v)** — [`account-deletion.md`](./account-deletion.md)).

**This document never holds a password.** Credentials live in App Store Connect
→ App Review Information, and in a password manager. An earlier OTP-only
review user (`00000000000071_review_account_otp.sql`, never applied) is why
we do not use a code for review.

See also: [`ios-releases.md`](./ios-releases.md) · [`apple-sign-in.md`](./apple-sign-in.md) ·
[`billing-setup.md`](./billing-setup.md) §11.

---

## How the reviewer signs in

On the native iOS login screen (TestFlight / App Store binary):

1. Tap **Sign in with email** (under Apple and Google).
2. Enter the email and password from **App Store Connect → the app → App
   Review Information**.
3. Tap **Sign in**. No email code. The account should land in the planner
   (14-day trial from `handle_new_user`, or a longer `trial_ends_at` if you
   extended it).

Alternates: **Sign in with Apple** / **Continue with Google** (Guideline 4.8 —
do not remove them). **Email me a code instead** is still there as a secondary
in-window path; review must not depend on it.

Account deletion: Settings → Account → Delete account (type **DELETE**). Also
on the locked / expired-trial screen.

---

## Wiring the review account (operator)

Do this once. Nothing here is committed.

1. **Supabase → Authentication → Providers → Email** — enable Email. Password
   sign-in must be on. Confirm-email can stay on for real signups; for the
   review user, create the account as **confirmed**.
2. **Authentication → Users → Add user** — email + password, auto-confirm.
   Prefer a dedicated address (e.g. a `review@…` inbox you control). Do **not**
   create this user via Google-only or Apple-only; those identities have no
   password.
3. **Entitlement** — a new user gets the 14-day trial. If review may outlast
   that, extend `subscriptions.trial_ends_at` for that `user_id` in the SQL
   editor. Do not grant a fake `active` Stripe/Apple row unless you mean it.
4. **App Store Connect → App Review Information** — paste email + password
   there. That is the only place the password belongs besides a password
   manager.
5. **Listing notes** — paste the block in § Listing notes below (no password
   in the repo copy).

Dev auto-login (`VITE_DEV_EMAIL` / `VITE_DEV_PASSWORD` in `.env.local`) is
**tree-shaken from production** (`import.meta.env.DEV`). It is not the review
path and must never be copied into the iOS CI env.

Optional bake-in, never a secret:

| Var | Where | What |
|---|---|---|
| `VITE_REVIEW_LOGIN=1` | Vite (iOS CI or a preview) | Forces the email+password door on that build. Native iOS already shows it via `isTauriIOS()` / `__TAURI_IOS__`. |
| `?review` | URL | Same door, for listing-notes / screenshot path. Dev also has `?login` (Login harness). |

---

## Listing notes (paste into App Store Connect)

```
WHAT THE APP IS
Nuvo is a personal daily planner. One person’s funnel — calendar, tasks,
projects — no shared objects.

SIGN-IN (Guideline 2.1 + 4.8)
Primary for review: Sign in with email → use the demo credentials in App
Review Information (email + password). No one-time code.
Apple and Google remain on the same screen (Guideline 4.8). Both stay in-app
on iOS (Apple = system sheet; Google = the app WKWebView).
“Email me a code instead” is optional and not required for review.

Account deletion: Settings → Account → Delete account (type DELETE). Also
reachable from the expired-trial lock screen.

SANDBOX / IAP
New accounts receive a 14-day app-managed trial (no card, no StoreKit intro
offer). After the trial, Subscribe uses StoreKit (NUVO_IAP_MONTHLY /
NUVO_IAP_ANNUAL). Restore Purchases is on the paywall and in Settings → Billing.
```

---

## What still blocks Submit (from the repo — not from ASC)

This repo **cannot see** App Store Connect agreement state. Confirm these in
the portal before anyone taps Submit. **Do not Submit from a coding session.**

| Item | What the repo knows | Who confirms |
|---|---|---|
| **Paid Apps Agreement** | IAP SKUs exist in Connect (`docs/billing-setup.md` §11: *“SKUs exist — not submitted”*). The Paid Apps Agreement is ASC-side. This session did **not** inspect the agreement. | Connect → Agreements, Tax, and Banking |
| **Sign in with Apple portal steps** | Code is shipped; `docs/apple-sign-in.md` still lists operator steps (capability, Services ID, Supabase secrets). | That runbook §1–§4 |
| **Review credentials** | The UI path is in the binary. The user must exist in Supabase with a password. | § Wiring above |
| **IAP catalog / product IDs** | Already in the iOS build (`NUVO_IAP_MONTHLY` / `NUVO_IAP_ANNUAL`). Do not retouch without need. | Connect subscription group Nuvo Pro |

---

## iPad taps (Guideline 2.1(a))

Dayspring was rejected because login options did nothing on iPad. Nuvo’s
login actions fire on **touch/pen pointerdown** (`useTapAction`) and on
**click** for mouse/keyboard. Hover is CSS-only (`@media (hover: hover) and
(pointer: fine)`). Email stays tappable while Apple/Google is opening. The
iOS Vite build stamps `__TAURI_IOS__` so an iPad that reports a Macintosh UA
still gets the phone login, not a Mac drag region.

Verify in the running app at **`?login`** (dev harness) at 375px and at an
iPad width. Device proof is the next TestFlight after merge.
