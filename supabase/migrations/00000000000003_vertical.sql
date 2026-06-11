-- Nuvo vertical layer: tasks -> projects -> initiatives -> domains.
-- Domains + projects already exist (00000000000001_core.sql). This migration
-- adds the missing middle (initiatives + key results), wires projects up to
-- initiatives, and gives domains the "anchor of faithfulness" fields.

-- ---------------------------------------------------------------------------
-- domains: the conscience layer. A standing intention + a weekly target so we
-- can read faithfulness (am I showing up here?) rather than raw throughput.
-- ---------------------------------------------------------------------------
alter table public.domains
  add column if not exists intention text not null default '',
  add column if not exists weekly_target_hours numeric,
  add column if not exists sort_order double precision not null default 0;

-- ---------------------------------------------------------------------------
-- initiatives: the bet with a finish line. Lives between domain and project.
-- ---------------------------------------------------------------------------
create table if not exists public.initiatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete set null,
  name text not null,
  outcome text not null default '',          -- what "done" looks like
  target_date date,
  status text not null default 'active',     -- active | paused | shipped | dropped
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists initiatives_user_domain_idx
  on public.initiatives (user_id, domain_id);

create trigger initiatives_set_updated_at
  before update on public.initiatives
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- key_results: the OKR rows under an initiative. Baseline lets us frame the
-- Gain (measured from where you started) rather than only the Gap.
-- ---------------------------------------------------------------------------
create table if not exists public.key_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  initiative_id uuid not null references public.initiatives (id) on delete cascade,
  name text not null,
  baseline_value numeric not null default 0,
  current_value numeric not null default 0,
  target_value numeric not null default 100,
  unit text not null default '%',
  sort_order double precision not null default 0
);

create index if not exists key_results_initiative_idx
  on public.key_results (initiative_id);

-- ---------------------------------------------------------------------------
-- projects: gain outcome + target + ordering, and a link UP to its initiative.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists initiative_id uuid references public.initiatives (id) on delete set null,
  add column if not exists outcome text not null default '',
  add column if not exists target_date date,
  add column if not exists sort_order double precision not null default 0;

create index if not exists projects_user_initiative_idx
  on public.projects (user_id, initiative_id);

-- ---------------------------------------------------------------------------
-- tasks: an energy bucket (Deep / Decide / Delegate / Quick) so the intelligent
-- Now can match the right work to the right slot.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists energy text
    check (energy is null or energy in ('deep', 'decide', 'delegate', 'quick'));

-- ---------------------------------------------------------------------------
-- Row level security for the new tables.
-- ---------------------------------------------------------------------------
alter table public.initiatives enable row level security;
alter table public.key_results enable row level security;

create policy "own initiatives" on public.initiatives
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own key_results" on public.key_results
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
