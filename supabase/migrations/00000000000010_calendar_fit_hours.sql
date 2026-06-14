-- How many hours of the day view fill the screen (vertical density).
-- Distinct from day_start_hour/day_end_hour, which set the scrollable window.
alter table public.user_settings
  add column if not exists calendar_fit_hours integer not null default 13
    check (calendar_fit_hours between 6 and 24);
