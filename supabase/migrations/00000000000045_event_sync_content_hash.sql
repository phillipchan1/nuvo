-- Stop calendar sync from rewriting rows that did not change.
--
-- WHY: ICS and CalDAV have no delta protocol, so both syncs re-imported the
-- whole window every 15 minutes and upserted every row unconditionally —
-- `last_synced_at` alone guaranteed every row differed, so Postgres wrote a new
-- tuple version for all of them. Measured on a single account: 3,109,992
-- updates against 2,796 live rows (~1,112 rewrites per row). Each write is a
-- WAL record that Realtime decodes and fans out to every subscribed client,
-- which then refetches the calendar — 3.6M refetches, 16.4h of DB CPU, and the
-- IOwait that took the whole pool down.
--
-- `content_hash` lets a sync read back a tiny (provider_event_id, content_hash)
-- projection and upsert ONLY genuinely-changed rows. Existing rows start NULL,
-- which reads as "changed" — so the first pass after deploy rewrites once, then
-- steady state drops to the real change rate.
alter table public.external_events
  add column if not exists content_hash text;

-- The reconcile read is (account_id[, calendar_id]) → provider_event_id,
-- content_hash. The existing unique key already leads with account_id and
-- calendar_id, so it covers the lookup; this index makes it index-only by
-- carrying the hash as a payload column.
create index if not exists external_events_sync_hash_idx
  on public.external_events (account_id, calendar_id)
  include (provider_event_id, content_hash);

-- Stagger the sync crons. All four used to land on the same tick (:00, :15,
-- :30, :45), so every provider contended for the connection pool at once and a
-- slow one pushed the others into "job startup timeout". cron.schedule upserts
-- by job name, so re-running this is safe.
select cron.schedule('nuvo-google-poll', '*/5 * * * *',
  $$select public.invoke_edge('google-sync', '{"mode":"poll"}')$$);
select cron.schedule('nuvo-m365-poll', '2-59/5 * * * *',
  $$select public.invoke_edge('m365-sync')$$);
select cron.schedule('nuvo-ics-poll', '4-59/15 * * * *',
  $$select public.invoke_edge('ics-sync')$$);
select cron.schedule('nuvo-icloud-poll', '9-59/15 * * * *',
  $$select public.invoke_edge('icloud-sync')$$);
