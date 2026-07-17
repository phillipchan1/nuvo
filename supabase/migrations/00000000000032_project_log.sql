-- Project log — a time-ordered journal of "what's going on" with a project.
--
-- Distinct from `brief` (static scope) and `activity_units` (external actuals):
-- this is the user's own running record of decisions, blockers, and context they
-- want to remember over the life of the project. Single-user, so no author — the
-- record modal shows it newest-first below the tasks.
--
-- One row per note. Cascade-deletes with its project.

create table public.project_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_comments_project_idx
  on public.project_comments (project_id, created_at desc);

alter table public.project_comments enable row level security;

create policy "own project_comments" on public.project_comments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
