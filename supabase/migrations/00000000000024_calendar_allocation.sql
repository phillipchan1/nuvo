-- Calendar events as a third allocation feed (actuals).
--
-- Until now "where I invest" (domain.investedThisWeek) only counted completed
-- task blocks + slots — meetings were invisible, so the picture lied. Attended
-- calendar events now roll up into the same domain ledger, as *actuals* (they
-- feed invested hours but never the weekly target/capacity — a week of SCE
-- meetings should read as honest time spent, not as "progress made").
--
-- Two new pieces:
--  1. `calendar_domain_map` — the deterministic default the user sets once:
--     a subscribed calendar's id → the domain every event from it belongs to
--     (SCE calendar → SCE, Frontier → Frontier). Shaped like hidden_calendar_ids.
--  2. `event_domain_routing` — the AI router's cache for events whose calendar
--     ISN'T in the map (a mixed personal calendar). The router reads each event
--     title/attendees through the domain `context` engine and we persist the
--     verdict per stable event key so we never re-spend tokens on render.

alter table public.user_settings
  add column if not exists calendar_domain_map jsonb not null default '{}';

-- AI-routed domain for events on unmapped calendars. event_key is stable across
-- re-sync: account_id || ':' || provider_event_id (NOT external_events.id, which
-- is reassigned when a calendar is re-imported).
create table if not exists public.event_domain_routing (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_key text not null,
  domain_id uuid references public.domains (id) on delete cascade,
  confidence real,
  routed_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

alter table public.event_domain_routing enable row level security;

create policy "own event_domain_routing" on public.event_domain_routing
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
