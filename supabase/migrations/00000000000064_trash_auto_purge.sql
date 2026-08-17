-- Auto-purge trashed tasks after 30 days.
--
-- `trashed_at` (migration 58) exists for this. Rows trashed before that column
-- were backfilled from `updated_at`; `coalesce` covers any stragglers. Emptying
-- the trash by hand stays an explicit human act — this only removes what has
-- aged out, the way Gmail and macOS Trash do.

select cron.schedule(
  'nuvo-purge-trash',
  '0 4 * * *',
  $$delete from public.tasks
     where status = 'trashed'
       and coalesce(trashed_at, updated_at) < now() - interval '30 days'$$
);
