# Account deletion

Status: **built** (2026-08-26 · D-117). Source: `supabase/functions/delete-account/`,
`src/components/account/DeleteAccount.tsx`. Closes App Store 5.1.1v (in-app delete)
and the "email us" gap in [`google-oauth-verification.md`](./google-oauth-verification.md) §6.

Hard-delete, not anonymize. The confirm word is **DELETE**. One function, two
surfaces: Settings → Account, and the locked screen (a lapsed trial still has
to be able to leave).

---

## 1 · What it does

```
Settings → Account → Delete account
Locked screen → Delete account
  → type DELETE
  → POST /functions/v1/delete-account  { confirm: "DELETE" }
     1. cancel Stripe if `subscriptions.stripe_subscription_id` is set
     2. revoke Google refresh tokens (best effort)
     3. drop Vault secrets (calendar + activity-source)
     4. auth.admin.deleteUser → cascades every user-owned row
  → wipe this device's outbox + query cache
  → sign out
```

The account cannot sign back in. A new signup with the same email is a new
empty account.

## 2 · Subscriptions

| How they pay | What we do |
|---|---|
| Stripe (web / Mac) | Cancel immediately via the existing Stripe client (`stripe.subscriptions.cancel`). If cancel fails and it is not already gone, the wipe stops so we do not keep billing a deleted account. |
| Apple / StoreKit | **We cannot cancel this.** The confirm panel says so and points at Apple Account settings (Settings → your name → Subscriptions). No StoreKit fields, no App Store Server API. |
| Trial, never paid | Skip billing. Wipe the row with the user. |

## 3 · What is not this

- **StoreKit pay path** — separate issue. This flow only *mentions* Apple
  subscriptions so a reviewer (and Vera) can leave.
- **Email-the-human** — still a last resort on the privacy page if they cannot
  open the app. The in-app path is the one that counts.
- **Delete forever** (a trashed task) — different act, different word.

## 4 · Deploy

```
# SQL editor or supabase db push — migration 70 (delete_secret)
supabase functions deploy delete-account --project-ref ebibzojtkzkphykznomv
```

`verify_jwt` stays on (default). Marketing `/privacy` ships with the web site.
