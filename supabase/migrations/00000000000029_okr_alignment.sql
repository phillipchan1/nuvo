-- OKR alignment: make the key_results layer load-bearing.
--
-- Initiatives already carry an outcome + a key_results table (00000003_vertical),
-- but nothing pointed work AT a key result, so initiative progress was only the
-- mean of child task-completion — activity, not the needle. This migration adds
-- the missing link: a task OR a project can name the key result it moves. With
-- that edge in place the selectors in src/lib/vertical.ts can read coverage
-- (does anything move this KR?) and the gap between effort and attainment.
--
-- on delete set null: key_results cascade-delete with their initiative; when a
-- KR goes away its supporting work simply unlinks (it doesn't vanish).

alter table public.tasks
  add column if not exists key_result_id uuid
    references public.key_results (id) on delete set null;

alter table public.projects
  add column if not exists key_result_id uuid
    references public.key_results (id) on delete set null;

create index if not exists tasks_key_result_idx
  on public.tasks (key_result_id);

create index if not exists projects_key_result_idx
  on public.projects (key_result_id);

-- key_results gain an updated_at so we can read staleness: a measured outcome
-- that hasn't been touched in weeks is drifting out of sight. Backfilled to now
-- for existing rows; kept fresh by the shared set_updated_at() trigger.
alter table public.key_results
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists key_results_set_updated_at on public.key_results;
create trigger key_results_set_updated_at
  before update on public.key_results
  for each row execute function public.set_updated_at();
