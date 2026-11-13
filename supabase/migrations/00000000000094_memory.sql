-- Memory (docs/memory.md). Two columns, no new table.
--
-- 1. user_settings.memory — the answers you gave Nuvo about itself: what you kept,
--    what you said wasn't true (and until when), whether it's learning, and when
--    you last looked. Observations are never stored; they're recomputed from the
--    calendar and your tasks every time, so they can't go stale. A jsonb column on
--    the settings row rides the existing offline outbox (user_settings is already
--    in apply_patch's allowlist) and the Cloudflare copy, where a new table would
--    need both. The client treats the column's ABSENCE on the row as "not set up
--    yet" and never writes it until it's there (the same rule as
--    default_calendar_id, D-152).
--
-- 2. domains.kind — which of the first-run picker's five kinds a domain is. The
--    picker always asked and then dropped the answer; Memory needs it to tell work
--    hours from the rest of your calendar. Null = not said.

alter table public.user_settings
  add column if not exists memory jsonb not null default '{}'::jsonb;

alter table public.domains
  add column if not exists kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'domains_kind_check') then
    alter table public.domains
      add constraint domains_kind_check
      check (kind is null or kind in ('work', 'community', 'discipline', 'people', 'stewardship'));
  end if;
end $$;
