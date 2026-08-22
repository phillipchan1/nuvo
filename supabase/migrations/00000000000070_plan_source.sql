-- ---------------------------------------------------------------------------
-- Two payment rails, one entitlement row.
--
-- Web: Stripe Checkout + Customer Portal (unchanged).
-- iOS App Store binary: StoreKit auto-renewable IAP only.
-- Both write `status` (the physical plan) + `plan_source` through the same
-- updater (`applyPlanUpdate` in the edge functions). Surfaces read `plan`
-- (computed alias of `status`) + `plan_source` + `entitled` / `is_entitled`.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists plan_source text
    check (plan_source is null or plan_source in ('stripe', 'apple'));

alter table public.subscriptions
  add column if not exists apple_original_transaction_id text;

alter table public.subscriptions
  add column if not exists apple_product_id text;

create unique index if not exists subscriptions_apple_original_transaction_id_uidx
  on public.subscriptions (apple_original_transaction_id)
  where apple_original_transaction_id is not null;

comment on column public.subscriptions.plan_source is
  'Which rail currently owns plan (status): stripe (Checkout) or apple (StoreKit). Null while trialing — neither store has been charged.';
comment on column public.subscriptions.apple_original_transaction_id is
  'StoreKit originalTransactionId. How App Store Server Notifications find the row.';
comment on column public.subscriptions.apple_product_id is
  'Last Apple product identifier (NUVO_IAP_MONTHLY / NUVO_IAP_ANNUAL). Not a price.';

-- Existing paid Stripe rows are already on that rail. Trials stay null.
update public.subscriptions
  set plan_source = 'stripe'
  where plan_source is null
    and (stripe_subscription_id is not null or stripe_customer_id is not null)
    and status in ('active', 'past_due', 'cancelled');

-- Public name for the plan column. Writers keep writing `status` so we
-- don't dual-write two physical sources of truth.
create or replace function public.plan(s public.subscriptions)
returns text language sql stable as $$
  select s.status;
$$;

-- The SQL twin of `isEntitled` in _shared/planRules.ts. Same rule: active,
-- or trialing with a future trial_ends_at. past_due is not entitled.
create or replace function public.entitled(s public.subscriptions)
returns boolean language sql stable as $$
  select s.status = 'active'
      or (s.status = 'trialing' and s.trial_ends_at > now());
$$;

create or replace function public.is_entitled(s public.subscriptions)
returns boolean language sql stable as $$
  select public.entitled(s);
$$;

-- App Store Server Notifications V2 idempotency ledger (notificationUUID).
create table if not exists public.apple_webhook_events (
  event_id   text primary key,
  created_at timestamptz not null default now()
);
alter table public.apple_webhook_events enable row level security;
revoke all on public.apple_webhook_events from anon, authenticated;
