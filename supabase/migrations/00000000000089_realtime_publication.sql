-- ---------------------------------------------------------------------------
-- Record production's `supabase_realtime` membership as a migration, so a stack
-- built from migrations publishes what production publishes. No more, no less.
--
-- Production's membership was set by hand in the dashboard; no migration ever
-- did it. So `supabase start` published ZERO tables, `useRealtime` received no
-- postgres_changes at all locally, and local testing silently disagreed with
-- prod. That is how the ghost-row bug hid locally: the open app never heard
-- about the seed's hard deletes.
--
-- Production, read 2026-10-15 (`pg_publication_tables`, puballtables = false),
-- publishes exactly four tables:
--
--   tasks · external_events · calendar_accounts · user_settings
--
-- The SPA subscribes to thirteen more: the rest of `TABLE_TO_KEYS` in
-- src/hooks/useRealtime.ts, plus `subscriptions` (useSubscriptionLiveSync).
-- Those channels join and deliver nothing, in production and now locally too.
-- That is deliberate. Publishing them would turn on live updates for them, and
-- it would also widen Realtime's cross-account DELETE stream: DELETEs are not
-- RLS-filtered, so every subscriber receives every account's deleted primary
-- keys. For `subscriptions` and `event_domain_routing` that key carries the
-- other account's user id. The way to make those tables live is per-account
-- broadcast, not a wider publication (see docs/offline-sync.md).
--
-- Idempotent and additive: a table that is already a member is skipped, so
-- this is a no-op on production. It never drops a member, never touches a
-- column list or row filter, and does nothing on a FOR ALL TABLES publication
-- (every table is already a member there, and ADD TABLE would be an error).
--
-- Replica identity stays DEFAULT (the primary key). All four tables have a PK
-- and RLS on, and under RLS Realtime sends only the PK in a DELETE's `old`,
-- even with FULL (checked locally). The PK is all liveApply.ts reads, and FULL
-- would write the whole previous row to WAL on every UPDATE of `tasks` and of
-- every 500-row calendar sync batch, with nothing reading it.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach t in array array[
    'tasks',
    'external_events',
    'calendar_accounts',
    'user_settings'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
