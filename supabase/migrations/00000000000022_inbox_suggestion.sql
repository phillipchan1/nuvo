-- Passive inbox grooming — Nuvo's cached *suggestion* for a raw capture: where
-- it likely belongs (a project / initiative / domain), how long it'll take, and
-- its energy register. A proposal ONLY — the real placement FKs, duration and
-- energy stay untouched until the user accepts. `suggestion` holds the jsonb
-- (including a structural signature of title+notes so we know when the capture
-- has changed under it and the guess has gone stale); `suggested_at` is when it
-- was groomed. Mirror of the soundness verdict on projects/initiatives.
alter table public.tasks
  add column if not exists suggestion jsonb,
  add column if not exists suggested_at timestamptz;
