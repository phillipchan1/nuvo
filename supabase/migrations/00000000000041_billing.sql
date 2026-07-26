-- ---------------------------------------------------------------------------
-- Stripe subscription billing. One dedicated table (not user_settings):
-- billing state is webhook-driven / service-role-written, a different
-- lifecycle and write-owner than the user-editable settings row, so RLS
-- stays simple — users can only ever read it, never write it directly.
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  status                 text not null default 'trialing'
                           check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at          timestamptz not null,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy "read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);
-- No insert/update/delete policy for authenticated/anon — RLS default-denies
-- everything else. All writes come from the service-role client in the
-- stripe-* edge functions (same trust model as calendar_accounts tokens).

-- ---------------------------------------------------------------------------
-- Single source of truth for entitlement — a PostgREST computed column, so
-- the client reads `entitled` directly instead of re-deriving the date math
-- itself. `status` never auto-transitions off 'trialing' when the trial
-- lapses; entitlement is computed lazily at read time from trial_ends_at.
-- This is a deliberate choice (no cron sweep needed), not an oversight.
-- ---------------------------------------------------------------------------
create or replace function public.entitled(s public.subscriptions)
returns boolean language sql stable as $$
  select s.status = 'active'
      or (s.status = 'trialing' and s.trial_ends_at > now());
$$;

-- ---------------------------------------------------------------------------
-- Webhook idempotency ledger. Service-role only — no policies at all means
-- RLS default-denies every role; the explicit revoke is defense-in-depth,
-- mirroring the store_secret/read_secret revoke pattern above.
-- ---------------------------------------------------------------------------
create table public.stripe_webhook_events (
  event_id   text primary key,
  created_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Extend the existing new-user bootstrap trigger to also grant a 14-day
-- no-card trial, atomically with domains/settings — no client-side "ensure"
-- call, no race where the app can render before a trial row exists.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  insert into public.domains (user_id, name, color) values
    (new.id, 'Work',    '#2563EB'),
    (new.id, 'Church',  '#7C3AED'),
    (new.id, 'Trading', '#0D9488'),
    (new.id, 'Family',  '#DB2777');
  insert into public.subscriptions (user_id, status, trial_ends_at)
    values (new.id, 'trialing', now() + interval '14 days');
  return new;
end;
$$;

-- Backfill every existing account (including Phil's own — no founder
-- override, everyone goes through the same trial/paywall flow) with a
-- fresh 14-day trial. Safe/idempotent to re-run.
insert into public.subscriptions (user_id, status, trial_ends_at)
select id, 'trialing', now() + interval '14 days'
from auth.users
where id not in (select user_id from public.subscriptions);
