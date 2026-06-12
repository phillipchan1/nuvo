-- Flows II: the Week Composer's boundaries + agent pre-work delegation.

-- Working hours are a compose boundary (immovable, like calendar events):
-- blocks are only proposed inside them. Distinct from day_start/day_end_hour,
-- which only control how much of the day the calendar *displays*.
alter table public.user_settings
  add column if not exists work_start_minutes integer not null default 480,   -- 8:00
  add column if not exists work_end_minutes integer not null default 990;     -- 16:30

-- Pre-work: the assistant prepares a task (approach, drafts, open questions)
-- and writes it here; prework_at set = "came back prepared ✦".
alter table public.tasks
  add column if not exists prework text not null default '',
  add column if not exists prework_at timestamptz;
