-- ---------------------------------------------------------------------------
-- ICS subscription provider — read-only calendar via a published iCalendar
-- (.ics) URL. No OAuth and no admin consent: the feed URL itself is the
-- credential and lives in Vault, referenced by
-- calendar_accounts.refresh_token_secret_id (reused as the feed-url secret id).
-- ---------------------------------------------------------------------------
alter type public.calendar_provider add value if not exists 'ics';

-- Poll subscribed feeds every 15 minutes. Exchange/Outlook regenerate the
-- published .ics only every few hours, so a tighter cadence buys nothing.
select cron.schedule('nuvo-ics-poll', '*/15 * * * *', $$select public.invoke_edge('ics-sync')$$);
