-- Per-account calendar sync dispatch — the multi-tenant fix.
--
-- BEFORE: one cron tick invoked one edge function per provider, and that single
-- invocation looped over EVERY account in the system, serially, against external
-- HTTP, inside a 60s invoke_edge timeout. Two things broke well before 1,000
-- users:
--
--   1. The account list came back through PostgREST, whose max_rows is 1000 on
--      this project. Past 1,000 accounts of a provider the remainder were
--      silently never synced — no error, no log entry, nothing.
--   2. CalDAV discovery alone costs seconds per account, so a serial loop blows
--      the timeout somewhere around a few dozen accounts. The invocation dies
--      partway and every account after that point simply doesn't sync — again
--      silently, and a different arbitrary set each run.
--
-- AFTER: cron runs one dispatcher every minute. It CLAIMS the accounts that are
-- actually due (in Postgres, so no 1000-row cap) and fires one async pg_net
-- request per account. Each edge invocation handles exactly one account, so
-- wall-clock per invocation is flat no matter how many tenants exist, one slow
-- feed can't starve anybody else, and a crash costs one account one cycle.

alter table public.calendar_accounts
  add column if not exists next_sync_at timestamptz,
  add column if not exists sync_failures int not null default 0;

-- The dispatcher orders by due-ness, so this is the index it rides.
create index if not exists calendar_accounts_due_idx
  on public.calendar_accounts (next_sync_at)
  where not needs_reconnect;

-- Base cadence per provider, widened by consecutive failures. A feed that has
-- been failing all week should not still be retried every 15 minutes: back off
-- to a maximum of one attempt a day, and snap straight back on first success.
create or replace function public.calendar_sync_interval(p_provider text, p_failures int)
returns int language sql immutable set search_path = '' as $$
  select least(
    (case p_provider
       when 'google' then 300
       when 'm365'   then 300
       when 'ics'    then 900
       when 'icloud' then 900
       else 900
     end) * (2 ^ least(greatest(coalesce(p_failures, 0), 0), 5))::int,
    86400
  );
$$;

-- Claim due accounts and fan out one invocation each.
--
-- The claim and the schedule bump are the SAME statement: `for update skip
-- locked` plus an immediate next_sync_at push means two overlapping ticks can
-- never hand the same account to two invocations, and an account already in
-- flight is simply not due yet. That is the backpressure — there is no separate
-- "is it running?" flag to leak.
create or replace function public.dispatch_calendar_sync(p_max int default 500)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    update public.calendar_accounts a
       set next_sync_at = now() + make_interval(
             secs => public.calendar_sync_interval(a.provider::text, a.sync_failures))
     where a.id in (
       select id
         from public.calendar_accounts
        where provider in ('google', 'm365', 'ics', 'icloud')
          and not needs_reconnect
          -- A never-synced account (null) is due immediately.
          and coalesce(next_sync_at, '-infinity'::timestamptz) <= now()
        order by coalesce(next_sync_at, '-infinity'::timestamptz)
        limit p_max
        for update skip locked
     )
    returning a.id, a.provider
  loop
    -- pg_net queues the request and returns immediately, so this loop dispatches
    -- rather than waits: N accounts cost one tick, not N round trips.
    perform public.invoke_edge(
      v_row.provider::text || '-sync',
      case
        when v_row.provider = 'google'
          then jsonb_build_object('mode', 'poll', 'accountId', v_row.id)
        else jsonb_build_object('accountId', v_row.id)
      end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.dispatch_calendar_sync(int) from public, anon, authenticated;

-- Called by each sync at the end of an account's pass. Success resets the
-- backoff and schedules the next run at base cadence; failure widens it.
create or replace function public.mark_calendar_sync(p_account uuid, p_ok boolean)
returns void language sql security definer set search_path = '' as $$
  update public.calendar_accounts
     set sync_failures = case when p_ok then 0 else coalesce(sync_failures, 0) + 1 end,
         next_sync_at = now() + make_interval(
           secs => public.calendar_sync_interval(
             provider::text,
             case when p_ok then 0 else coalesce(sync_failures, 0) + 1 end))
   where id = p_account;
$$;

revoke all on function public.mark_calendar_sync(uuid, boolean) from public, anon, authenticated;

-- Retire the four per-provider polling crons in favour of one dispatcher.
-- Cadence now lives in calendar_sync_interval, per provider AND per account
-- health, instead of being frozen into four cron expressions.
select cron.unschedule('nuvo-google-poll') where exists (select 1 from cron.job where jobname = 'nuvo-google-poll');
select cron.unschedule('nuvo-m365-poll')   where exists (select 1 from cron.job where jobname = 'nuvo-m365-poll');
select cron.unschedule('nuvo-ics-poll')    where exists (select 1 from cron.job where jobname = 'nuvo-ics-poll');
select cron.unschedule('nuvo-icloud-poll') where exists (select 1 from cron.job where jobname = 'nuvo-icloud-poll');

select cron.schedule('nuvo-calendar-dispatch', '* * * * *',
  $$select public.dispatch_calendar_sync()$$);

-- Existing accounts have a null next_sync_at, which reads as "due now". Spread
-- them across the first cadence window so an upgrade doesn't dispatch every
-- account in the system on the very first tick.
update public.calendar_accounts
   set next_sync_at = now() + make_interval(secs => (random() * 300)::int)
 where next_sync_at is null;
