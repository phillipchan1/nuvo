-- D-152: the default for new events is a calendar, not just an account.
-- `default_calendar_account_id` (migration 27) still names the account; this
-- names which of its calendars. A calendar id alone is not an address — the same
-- shared calendar can sit under two accounts — so it is only read inside that
-- account (_shared/defaultCalendar.ts). Null = the account's own calendar, which
-- is exactly what every row meant before this column existed.

alter table public.user_settings
  add column if not exists default_calendar_id text;
