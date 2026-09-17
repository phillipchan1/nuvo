-- ---------------------------------------------------------------------------
-- Reminder leads as a list (D-137).
--
-- Calendar apps let you put several alerts on one meeting (10 minutes and
-- 1 day before). The unique index stays one row per (item, anchor); the
-- vocabulary moves from a single integer to an array.
--
--   no row          follow the defaults
--   leads = '{}'    silenced — a deliberate "not this one"
--   leads = '{1440,10}'  those two
-- ---------------------------------------------------------------------------

alter table public.reminders
  add column if not exists leads integer[] not null default '{}'::integer[];

update public.reminders
set leads = case
  when lead_minutes is null then '{}'::integer[]
  else array[lead_minutes]
end;

alter table public.reminders
  drop column if exists lead_minutes;

alter table public.reminders
  drop constraint if exists reminders_leads_cap;
alter table public.reminders
  add constraint reminders_leads_cap check (cardinality(leads) <= 5);

alter table public.reminders
  drop constraint if exists reminders_leads_nonneg;
alter table public.reminders
  add constraint reminders_leads_nonneg check (
    not exists (select 1 from unnest(leads) x where x is null or x < 0)
  );

comment on column public.reminders.leads is
  'Minutes before the anchor, 0–5 values. Empty = silenced. No row at all = follow Settings defaults.';

comment on column public.user_settings.reminder_prefs is
  'Reminder defaults: {enabled, event_leads, block_leads, deadline_leads, all_day_leads, deadline_time_minutes}. Shape + fill in _shared/reminderRules.ts. enabled defaults false. Legacy scalar keys (event_lead, …) still normalize.';
