-- Soundness — Nuvo's cached judgment of whether a project / initiative is
-- genuinely ready (outcome, steps, time, dates), not just structurally filled
-- in. `verification` holds the verdict jsonb (including a structural signature
-- so we know when it's gone stale); `verified_at` is when it was judged. This
-- is the one persisted bit of the soundness layer — everything else is computed.

alter table public.projects
  add column if not exists verification jsonb,
  add column if not exists verified_at timestamptz;

alter table public.initiatives
  add column if not exists verification jsonb,
  add column if not exists verified_at timestamptz;
