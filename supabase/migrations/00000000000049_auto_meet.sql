-- Auto-attach a Google Meet link to events Nuvo creates.
--
-- Google's own "automatically add video conferencing" preference lives in their
-- web UI and is never applied to API-created events, so an event booked from
-- Nuvo arrived with no way to meet digitally. This is the account's standing
-- answer; the composer can still override it per event.
--
-- 'guests'  — a meeting with someone gets a room, a solo block doesn't (default)
-- 'always'  — every event Nuvo creates gets one
-- 'never'   — never ask Google for a conference
alter table public.user_settings
  add column if not exists auto_add_meet text not null default 'guests'
    check (auto_add_meet in ('guests', 'always', 'never'));

comment on column public.user_settings.auto_add_meet is
  'When Nuvo attaches a Google Meet link to events it creates: guests (default) | always | never. The per-event toggle in the composer overrides it.';
