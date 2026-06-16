-- Flows V: tie a task to the priority (big rock) it serves, so a priority owns
-- its work DIRECTLY — independent of any initiative or project. This is the
-- keystone that makes a priority trackable (progress = its tasks done) and lets
-- the brain-dump / break-down attach generated work to the rock even when no
-- initiative is set.
--
-- The id is the client-generated uuid of a big_rocks[] element (jsonb), so this
-- is a plain text reference, not a FK — deleting a rock just orphans its tasks.
alter table public.tasks
  add column if not exists big_rock_id text;

create index if not exists tasks_user_big_rock_idx
  on public.tasks (user_id, big_rock_id) where big_rock_id is not null;
