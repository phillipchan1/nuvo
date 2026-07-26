-- ---------------------------------------------------------------------------
-- First-run orientation. We store the ORIENTATION_VERSION the user last completed
-- (not a bool) so a major feature launch can bump the version in code and re-surface
-- the welcome once: show when this is null or < the current ORIENTATION_VERSION.
-- Nullable + additive; the existing user_settings upsert (select *) carries it through.
-- ---------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists onboarding_completed_version integer;
