-- ---------------------------------------------------------------------------
-- Completion time is `tasks.completed_at`. The column has existed since
-- migration 1. This migration does two things and one deliberate non-thing:
--
-- 1. Restate the column (IF NOT EXISTS) so a fresh apply is idempotent.
-- 2. Index (user_id, completed_at) for "done this week" reads.
-- 3. Do NOT backfill null stamps from `updated_at`.
--
-- Why no backfill: `tasks_set_updated_at` fires on every row mutation — title,
-- notes, labels, parent, a later edit of an already-done task. `updated_at` is
-- "last touched", not "finished". Crediting a title tweak to the edit day
-- would invent a completion the operator never made (P7). Older done rows
-- without a stamp stay null; list_completed / list_tasks omit them rather
-- than guess. The product already treats that gap as real (D-090, ledger A2).
--
-- Apply by hand when you choose — this file is not run against production
-- by CI, Vercel, or the MCP deploy. See the PR that added it.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists completed_at timestamptz;

comment on column public.tasks.completed_at is
  'When status became ''done''. Set on every complete path; cleared on reopen. Never inferred from updated_at — that column moves on later edits of done rows.';

-- This user's finished work, newest first. Partial: open / unstamped rows
-- do not belong in a completion-window scan.
create index if not exists tasks_completed_at_idx
  on public.tasks (user_id, completed_at desc)
  where status = 'done' and completed_at is not null;
