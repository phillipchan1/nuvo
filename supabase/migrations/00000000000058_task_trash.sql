-- ---------------------------------------------------------------------------
-- A floor under delete.
--
-- `tasks.status = 'trashed'` has existed since the beginning and is written by
-- every delete path — but nothing ever LISTED it. Every surface filters it out
-- (the calendar, mobile search, the agent's record cards, `fetchAllTasks`), and
-- no surface offers a restore. So once the six-second undo toast expired, a
-- trashed task was unrecoverable from inside the app: data loss with no visible
-- floor, which the 2026-08-12 audit ranked 8th of 10.
--
-- The fix is almost entirely UI. The one thing the schema owes it is WHEN — a
-- trash view sorts newest-first, and a future auto-purge needs an age to
-- measure. Nothing is deleted by this migration and nothing is deleted on a
-- schedule yet; emptying stays an explicit human act.
-- ---------------------------------------------------------------------------

alter table public.tasks add column if not exists trashed_at timestamptz;

comment on column public.tasks.trashed_at is
  'When status became ''trashed''. Sorts the trash view and gives a future purge an age to measure. Cleared on restore.';

-- Rows trashed before this column existed have no stamp. `updated_at` is the
-- closest true thing we have — it is when they were last touched, and for a
-- trashed row that touch was almost always the trashing.
update public.tasks
   set trashed_at = updated_at
 where status = 'trashed' and trashed_at is null;

-- The trash view's only query: this user's trashed rows, newest first.
create index if not exists tasks_trashed_idx
  on public.tasks (user_id, trashed_at desc)
  where status = 'trashed';
