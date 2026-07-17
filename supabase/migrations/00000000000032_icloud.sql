-- ---------------------------------------------------------------------------
-- iCloud (Apple Calendar) provider — two-way sync over CalDAV.
-- Apple has no OAuth for calendars; the credential is the user's Apple ID plus
-- an app-specific password (appleid.apple.com → App-Specific Passwords). The
-- password lives in Vault, referenced by calendar_accounts.refresh_token_secret_id
-- (reused, as with ICS); the Apple ID is the account email/CalDAV username.
-- ---------------------------------------------------------------------------
alter type public.calendar_provider add value if not exists 'icloud';

-- Poll iCloud CalDAV every 15 minutes. CalDAV has no delta/webhook we can rely
-- on cheaply, so each run re-queries the window and reconciles — same cadence
-- and shape as the ICS poll.
select cron.schedule('nuvo-icloud-poll', '*/15 * * * *', $$select public.invoke_edge('icloud-sync')$$);
