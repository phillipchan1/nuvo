-- When a project actually SHIPPED — not when it was due.
--
-- Shipping is a judgment you make on a day, and until now nothing recorded that
-- day: a project carried `status = 'complete'` and nothing else. That made the
-- week's scoreboard lie. `weekPushes` derives the week's slate from the projects
-- committed to it, and it drops anything complete — so shipping a project on
-- Wednesday ERASED it from "The week's plan" instead of crowning it, and the
-- "N of M landed" tally silently lost both numbers. You finished your biggest
-- thing and the week forgot.
--
-- With a real ship date the slate can keep what you shipped *inside* the week
-- while still dropping what shipped long ago.
--
-- Backfill uses target_date (the planned finish — the best guess history has,
-- and what the Shipped rail already dates wins by), falling back to created_at
-- so the column is never null on an already-shipped row.

alter table public.projects
  add column if not exists shipped_at timestamptz;

update public.projects
   set shipped_at = coalesce(target_date::timestamptz, created_at)
 where status = 'complete'
   and shipped_at is null;
