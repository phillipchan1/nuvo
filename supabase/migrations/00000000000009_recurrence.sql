-- Repeating tasks & time slots.
--
-- Model decision (consistent with "a task IS a block"): a recurrence is NOT a
-- virtual rule expanded at read time — it's a *generator*. One `recurrences`
-- row holds the rule + a template; concrete `tasks`/`slots` occurrences are
-- materialized from it up to a rolling horizon (client-side, on app open and on
-- create). Each occurrence is an ordinary row, so drag/resize/mirror/rollover
-- and slot-children all keep working with zero special-casing.
--
-- (Repeating *calendar events* are handled natively by Google via an RRULE on
-- create — see the google-events function — so they need no rows here.)

create table public.recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- what this series produces
  kind text not null check (kind in ('task', 'slot')),

  -- ── the rule ──────────────────────────────────────────────────────────
  freq text not null check (freq in ('daily', 'weekly', 'monthly')),
  interval integer not null default 1 check (interval > 0),
  byweekday integer[] not null default '{}',     -- 0=Sun … 6=Sat (weekly)
  bymonthday integer,                            -- 1..31 (monthly; else anchor's day)
  anchor_date date not null,                     -- occurrence #1, the rule's origin
  until_date date,                               -- inclusive end bound (optional)
  max_count integer check (max_count is null or max_count > 0), -- cap (optional)
  exdates date[] not null default '{}',          -- skipped occurrence dates

  -- ── the template every occurrence is stamped from ────────────────────
  title text not null default '',
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  -- start time as minutes after local midnight; null = a dated to-do with no
  -- block (tasks only — slots always carry a time).
  time_of_day_minutes integer check (time_of_day_minutes between 0 and 1439),
  project_id uuid references public.projects (id) on delete set null,
  domain_id uuid references public.domains (id) on delete set null,
  priority public.task_priority not null default 'none',
  color text,

  active boolean not null default true,
  last_materialized date                         -- horizon bookkeeping
);

create index recurrences_user_idx on public.recurrences (user_id) where active;

create trigger recurrences_set_updated_at
  before update on public.recurrences
  for each row execute function public.set_updated_at();

alter table public.recurrences enable row level security;
create policy "own recurrences" on public.recurrences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Occurrence links on tasks & slots ──────────────────────────────────────
-- recurrence_overridden: a per-occurrence edit (THIS scope) pins the row so a
-- later "edit all" regeneration leaves it alone.
alter table public.tasks
  add column recurrence_id uuid references public.recurrences (id) on delete set null,
  add column recurrence_date date,
  add column recurrence_overridden boolean not null default false;

alter table public.slots
  add column recurrence_id uuid references public.recurrences (id) on delete set null,
  add column recurrence_date date,
  add column recurrence_overridden boolean not null default false;

-- One row per (series, date): the dedup that makes materialization idempotent.
-- A plain UNIQUE (not partial) so PostgREST can guard races cheaply — normal
-- rows have recurrence_id null and Postgres treats every (null, …) as distinct,
-- so they never collide. The composite also indexes recurrence_id lookups.
alter table public.tasks
  add constraint tasks_recurrence_occurrence_uniq unique (recurrence_id, recurrence_date);
alter table public.slots
  add constraint slots_recurrence_occurrence_uniq unique (recurrence_id, recurrence_date);

-- ── Rollover: never roll a recurring occurrence ────────────────────────────
-- A missed occurrence is simply missed — tomorrow already has its own fresh
-- one materialized, so rolling would pile up duplicates.
create or replace function public.rollover_tasks(p_today date)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.tasks
     set do_date = p_today,
         start_time = null,
         roll_count = roll_count + 1,
         status = 'planned'
   where status in ('inbox', 'planned')
     and do_date is not null
     and do_date < p_today
     and recurrence_id is null
  returning *;
end;
$$;

revoke all on function public.rollover_tasks(date) from public, anon, authenticated;
