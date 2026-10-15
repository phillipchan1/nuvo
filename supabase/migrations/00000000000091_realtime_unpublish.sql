-- Close the cross-account DELETE stream: take the live tables out of
-- `supabase_realtime`.
--
-- PRODUCTION: apply only after the clients that listen on broadcast
-- (migration 90) have shipped and been picked up. A desktop or PWA build still
-- on `postgres_changes` loses its live updates here, on the four tables
-- production publishes (migration 89: tasks, external_events,
-- calendar_accounts, user_settings), and falls back to the 60s pull and focus
-- refetches. Nothing is lost, it is just slower until it updates. The loop
-- names all 17 live tables so a hand-widened publication is cleaned up as well.
--
-- Until this runs the leak is open no matter what the clients do. Realtime
-- answers any authenticated `postgres_changes` join on a published table with
-- every account's DELETE primary keys, so filtering on our side changes what we
-- receive, not what the server sends.
--
-- Guarded per table: dropping a non-member is an error, and production's
-- membership was set by hand. A FOR ALL TABLES publication is left alone
-- (it can't drop single tables) and needs a human.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    raise warning 'supabase_realtime is FOR ALL TABLES; live tables are still published';
    return;
  end if;
  foreach t in array array[
    'tasks', 'task_labels', 'slots', 'recurrences', 'labels', 'external_events',
    'calendar_accounts', 'user_settings', 'domains', 'initiatives', 'projects',
    'record_comments', 'key_results', 'sprints', 'week_reviews',
    'event_domain_routing', 'subscriptions'
  ] loop
    if exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;
