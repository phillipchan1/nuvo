-- Activity Sources — external feeds of *completed* work routed to projects as
-- actuals (what happened), the second instance of the pattern the calendar feed
-- already proved (see 00000000000024_calendar_allocation.sql). GitHub merged PRs
-- are source #2: each is a timestamped, human-titled unit of shipped work that
-- binds to a project and, through rollup, lights up that project's domain.
-- Spec: docs/activity-sources.md.
--
-- Three tables, generically named so source #3 (Strava, PCO, …) is a new `kind`,
-- not a migration:
--   activity_sources  — one connected account (a GitHub PAT, held in Vault)
--   activity_bindings — repo → project (a repo ≈ a project; domain inherited)
--   activity_units    — one merged PR (idempotent on the PR node id)

create table if not exists public.activity_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'github',        -- 'github' | future kinds
  login text,                                 -- the @handle (display only)
  avatar_url text,
  token_secret_id uuid,                       -- Vault pointer to the PAT; a bare
                                              -- uuid, useless without service role
  repos jsonb not null default '[]'::jsonb,   -- [{ full_name, pushed_at, private }]
  needs_reconnect boolean not null default false,
  cursor timestamptz,                         -- high-water mark of merged_at synced
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, login)
);

create trigger activity_sources_updated_at before update on public.activity_sources
  for each row execute function public.set_updated_at();

alter table public.activity_sources enable row level security;
create policy "own activity_sources" on public.activity_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- repo → project. A repo ≈ a project; the project rolls up to its domain, so we
-- never bind a source to a domain directly. `selector` is the repo full_name
-- ("philchan/nuvo") — stable across re-sync.
create table if not exists public.activity_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references public.activity_sources (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  selector text not null,                     -- repo full_name
  created_at timestamptz not null default now(),
  unique (source_id, selector)
);

alter table public.activity_bindings enable row level security;
create policy "own activity_bindings" on public.activity_bindings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One merged PR. external_id is the PR's GraphQL node id (stable, idempotent).
-- project_id is the routed target (from the binding at pull time); on set null we
-- keep the unit but it falls out of any project rollup.
create table if not exists public.activity_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references public.activity_sources (id) on delete cascade,
  kind text not null default 'github',
  external_id text not null,                  -- PR node id
  title text not null default '',             -- the PR title — human-authored
  url text,
  selector text,                              -- repo full_name (grouping / re-route)
  project_id uuid references public.projects (id) on delete set null,
  occurred_at timestamptz not null,           -- merged_at
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists activity_units_user_occurred on public.activity_units (user_id, occurred_at desc);
create index if not exists activity_units_project on public.activity_units (project_id);

alter table public.activity_units enable row level security;
create policy "own activity_units" on public.activity_units
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Passive pull: daily is plenty (merged-PR volume is low). The edge fn syncs
-- every connected source's bound repos since its cursor.
select cron.schedule('nuvo-github-poll', '20 9 * * *', $$select public.invoke_edge('github-activity', '{"action":"sync"}')$$);
