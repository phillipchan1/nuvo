-- The duration a new task/slot/recurring series gets when nothing else says
-- otherwise. Was hardcoded to 30 minutes everywhere (DEFAULT_DURATION_MINUTES);
-- this makes it a per-account preference (Settings → Schedule).
alter table public.user_settings
  add column if not exists default_task_duration_minutes integer not null default 30;
