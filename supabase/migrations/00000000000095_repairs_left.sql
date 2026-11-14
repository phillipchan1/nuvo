-- "Leave it where it is", remembered per account (D-207, docs/rail-line.md §4.2).
--
-- A repair you answered "Leave it where it is" must not be asked again for the
-- same block at the same time. It lived in localStorage (`nuvo.repairsLeft.v1`),
-- so the phone asked what the Mac had already been told. One jsonb column on the
-- settings row: an array of repair keys (`task:<id>@<start_time>`), capped at 300
-- by the client. It rides the existing outbox (user_settings is already in
-- apply_patch's allowlist) and the Cloudflare copy, where a new table would need
-- both. The client treats the column's ABSENCE on the row as "not migrated yet"
-- and keeps using localStorage until it's there (the D-152 / migration 94 rule).
--
-- Neon: the same column is in worker/schema/neon.sql — apply both.

alter table public.user_settings
  add column if not exists repairs_left jsonb not null default '[]'::jsonb;
