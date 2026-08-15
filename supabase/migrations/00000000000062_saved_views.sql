-- Saved views — the rank-6 half that persists.
--
-- Deliberately NOT a table. A saved view is a named question about the tasks
-- that already exist; it files nothing, holds nothing, and can't be scheduled
-- or shipped. Giving it a table would make it look like a fifth pool (P10) and
-- would invite a foreign key from tasks to "the view it's in", which is exactly
-- the shape we refused. It rides on user_settings, next to reminder_prefs.
--
-- The value is `SavedView[]` from supabase/functions/_shared/taskQuery.ts:
--   [{ id, name, query: TaskQuery, createdAt }]
-- Every date inside a TaskQuery is RELATIVE ("this_week", "overdue"), so a view
-- saved today still means the same thing next month. There is no way to store
-- an absolute range, on purpose.
--
-- user_settings is already in the offline-sync allowlist (migration 53) and
-- apply_patch merges it per-field, so a view saved on a plane lands on arrival
-- without a new column in either list.

alter table public.user_settings
  add column if not exists saved_views jsonb not null default '[]'::jsonb;

comment on column public.user_settings.saved_views is
  'Named task queries (SavedView[] — see _shared/taskQuery.ts). Not a pool: a '
  'view holds a question, never work. Windows are relative so a view never '
  'goes stale. Capped at MAX_SAVED_VIEWS in the client.';
