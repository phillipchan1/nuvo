-- Flows III: per-day contexts for the Week Composer.
-- A map of dayISO -> context ('normal' | 'light' | 'travel' | 'off') on the
-- week being planned. Contexts are boundaries: travel days never get deep
-- blocks, off days get nothing, light days stay half-empty.
alter table public.sprints
  add column if not exists day_contexts jsonb not null default '{}'::jsonb;
