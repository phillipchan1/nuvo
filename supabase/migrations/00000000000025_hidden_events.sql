-- Hide individual calendar events (Fantastical-style "hide", not delete).
--
-- A hidden event stays on the server — we just keep it out of your way: it drops
-- off the board and, more importantly, out of the "what's busy" math, so its time
-- is free again for blocking. Reversible from the calendar (the eye toggle) or
-- Settings.
--
-- Keyed by the STABLE event key — account_id || ':' || provider_event_id — never
-- external_events.id (which is reassigned on a calendar re-import; see migration
-- 00000000000024). A whole series is keyed account_id || ':series:' || recurring_event_id,
-- so every instance shares one key. We store the title alongside the key so the
-- Settings "Hidden events" list stays readable even for events outside the current
-- fetch window.
--
-- Shape: [{ "key": "<account>:<provider_event_id>", "title": "Standup" }, …]

alter table public.user_settings
  add column if not exists hidden_events jsonb not null default '[]'::jsonb;
