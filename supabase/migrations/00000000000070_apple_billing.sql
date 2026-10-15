-- ---------------------------------------------------------------------------
-- Recovered from production's migration history (`supabase migration fetch`,
-- 2026-10-14). This is what production ran as version 70 — committed here for
-- the first time, so the repo builds the database production actually has.
--
-- Version 70 was claimed twice: this file (applied, never committed) and
-- `delete_secret` (committed, never applied — `db push` saw 70 as done and
-- skipped it in silence). delete_secret now runs as 88. Same trap as 71 →
-- plan_source; tests/migrations-unique.test.ts can only see collisions inside
-- the repo, not against what production recorded.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A second biller: Apple.
--
-- Nuvo now sells the same subscription in two places — Stripe on the web and
-- the macOS app, StoreKit on the iPhone (App Store guideline 3.1.1 requires
-- in-app purchase for the App Store build, and Nuvo ships worldwide, where
-- linking out to Stripe is still prohibited). One account can therefore be
-- paid for through either, and must unlock everywhere either way.
--
-- The shape that makes that safe: Apple's state lives in its OWN columns, so
-- the two webhooks can never overwrite each other. `stripe-webhook` writes
-- only `status` / `stripe_*` / `price_id` / `current_period_end`;
-- `apple-notifications` writes only `apple_*`. Entitlement is the OR of the
-- two plus the trial, computed at read time in `entitled()` — still the single
-- source of truth, still never re-derived on a client.
--
-- The alternative (one `status` column both billers write) was rejected: a
-- Stripe `customer.subscription.deleted` for a lapsed old card would have set
-- status='cancelled' and locked out someone paying happily through Apple.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  -- Apple's stable identifier for the whole subscription lineage — it survives
  -- renewals, upgrades and resubscribes, which the per-renewal transaction id
  -- does not. UNIQUE so one App Store subscription can never entitle two Nuvo
  -- accounts: a second account trying to claim it fails loudly here rather
  -- than quietly granting a free ride.
  add column apple_original_transaction_id text unique,
  add column apple_product_id              text,
  add column apple_status                  text
    check (apple_status in ('active', 'grace', 'expired', 'revoked')),
  -- Paid through. During a billing-retry grace period this is in the PAST and
  -- `apple_grace_until` is what's carrying them — see entitled() below.
  add column apple_expires_at              timestamptz,
  add column apple_grace_until             timestamptz,
  add column apple_auto_renew              boolean not null default false,
  -- 'sandbox' is a TestFlight or simulator purchase. Recorded rather than
  -- rejected (TestFlight is how the flow gets tested at all), but it lets the
  -- server refuse to let a free sandbox receipt touch a real paying account.
  add column apple_environment             text
    check (apple_environment in ('production', 'sandbox'));
-- ---------------------------------------------------------------------------
-- Entitlement, now the OR of three independent grants.
--
-- Replaces the two-arm version from migration 41. The trial and Stripe arms
-- are unchanged; the Apple arm is added. Note the two Apple shapes:
--   · active — paid through `apple_expires_at`, which is in the future
--   · grace  — the renewal FAILED and Apple is retrying the card. `expires_at`
--              has already passed, so only `grace_until` keeps them in. Apple
--              expects the service to stay on for this window; cutting someone
--              off mid-retry is how a recoverable card decline becomes a churn.
--
-- The `coalesce` is load-bearing, not defensive tidying. Every Apple column is
-- NULL on an account that has never bought through the App Store — which is
-- every existing account — so `apple_status = 'active'` is NULL, not false,
-- and `false or false or NULL` is NULL in SQL's three-valued logic. The
-- two-arm version could only ever return true or false; without this, adding
-- the Apple arms made `entitled` come back NULL for a lapsed web account.
-- Caught by running it against the real table, not by reading it.
-- ---------------------------------------------------------------------------
create or replace function public.entitled(s public.subscriptions)
returns boolean language sql stable as $$
  select coalesce(
         s.status = 'active'
      or (s.status = 'trialing' and s.trial_ends_at > now())
      or (s.apple_status = 'active' and s.apple_expires_at  > now())
      or (s.apple_status = 'grace'  and s.apple_grace_until > now()),
    false);
$$;
-- ---------------------------------------------------------------------------
-- Who to send them to when they want to change or cancel.
--
-- Exposed as a computed column beside `entitled` so no surface has to work it
-- out. It is load-bearing for more than routing: Apple does not permit an app
-- to cancel an App Store subscription itself, so an Apple-billed account must
-- be sent to iOS Settings, and a Stripe-billed one must NOT be (the Billing
-- Portal would 404 — there is no Stripe customer).
--
-- Apple is checked first. If an account somehow carries both (the Phase 5
-- guards exist to stop that), Apple is the one the user cannot cancel from
-- here, so it is the one worth naming; BillingPane surfaces the Stripe side
-- separately off `stripe_subscription_id` when both are present.
-- ---------------------------------------------------------------------------
create or replace function public.billing_source(s public.subscriptions)
returns text language sql stable as $$
  select case
    when (s.apple_status = 'active' and s.apple_expires_at  > now())
      or (s.apple_status = 'grace'  and s.apple_grace_until > now())      then 'apple'
    when s.status = 'active'                                              then 'stripe'
    when s.status = 'trialing' and s.trial_ends_at > now()                then 'trial'
    else 'none'
  end;
$$;
-- ---------------------------------------------------------------------------
-- Apple's idempotency ledger, mirroring stripe_webhook_events.
--
-- App Store Server Notifications V2 are at-least-once and Apple retries for up
-- to three days, so the same notificationUUID will arrive more than once. The
-- primary key is the whole mechanism: insert first, and a duplicate key means
-- "already handled, stop."
--
-- Service-role only. No policies at all means RLS default-denies every role;
-- the explicit revoke is defense-in-depth.
-- ---------------------------------------------------------------------------
create table public.apple_notification_events (
  notification_uuid text primary key,
  notification_type text,
  received_at       timestamptz not null default now()
);
alter table public.apple_notification_events enable row level security;
revoke all on public.apple_notification_events from anon, authenticated;
