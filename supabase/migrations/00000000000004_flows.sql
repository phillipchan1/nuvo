-- Nuvo flows layer: the Week gate between the vertical and the days.
-- (docs/execution-flows.md) Adds: the 'backlog' task status (planned-but-dormant
-- work that never touches the inbox or Today), the sprints table (one row per
-- week: goal + lead initiatives + review timestamp), task links up to sprint
-- and initiative, an agent assignee for delegation, and the column parity the
-- floors need now that the vertical store reads live rows instead of the
-- localStorage prototype.

-- ---------------------------------------------------------------------------
-- task_status: backlog = processed and parented, deliberately undated.
-- Rollover only touches inbox/planned, so backlog work never guilt-rolls.
-- ---------------------------------------------------------------------------
alter type public.task_status add value if not exists 'backlog';

-- ---------------------------------------------------------------------------
-- sprints: the week as a real entity, not a flag.
-- ---------------------------------------------------------------------------
create table if not exists public.sprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,                       -- Monday (user_settings.week_start)
  goal text not null default '',
  focus_initiative_ids uuid[] not null default '{}',  -- the week's "lead" bets (≤3)
  reviewed_at timestamptz,                        -- set when the Sunday ritual completes
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

alter table public.sprints enable row level security;
create policy "own sprints" on public.sprints
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- tasks: link up to sprint + initiative, and an assignee for agent delegation.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists sprint_id uuid references public.sprints (id) on delete set null,
  add column if not exists initiative_id uuid references public.initiatives (id) on delete set null,
  add column if not exists assignee text not null default 'me'
    check (assignee in ('me', 'agent'));

create index if not exists tasks_user_sprint_idx
  on public.tasks (user_id, sprint_id) where sprint_id is not null;
create index if not exists tasks_user_initiative_idx
  on public.tasks (user_id, initiative_id) where initiative_id is not null;

-- ---------------------------------------------------------------------------
-- Column parity for the live vertical (was localStorage-only prototype state).
-- invested/quarter/last-touched are NOT stored — they derive from completed
-- blocks (a task IS a block, so done tasks are the time ledger).
-- ---------------------------------------------------------------------------
alter table public.domains
  add column if not exists icon text not null default '◇';

alter table public.initiatives
  add column if not exists description text not null default '',
  add column if not exists start_date date,
  add column if not exists momentum text not null default 'flat'
    check (momentum in ('up', 'flat', 'down')),
  add column if not exists progress integer not null default 0;  -- fallback when no projects

alter table public.projects
  add column if not exists description text not null default '',
  add column if not exists start_date date,
  add column if not exists progress integer not null default 0;  -- fallback when no tasks
