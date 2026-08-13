-- ---------------------------------------------------------------------------
-- Steps — a checklist inside a task.
--
-- A task was a leaf. The funnel gives you project → task, but not the small
-- ordered list inside one task that Todoist, Things, TickTick and Microsoft
-- To Do all have (audit rank 5).
--
-- ── Why this is a column on `tasks` and not a `steps` table ─────────────────
--
-- Principle 10 says don't add a pool without paying for it, and a second table
-- would be a fifth pool with its own lifecycle, its own sync entry, its own
-- rollups. The payment we make instead is a RESTRICTION: **a step is not a
-- task.** It may have a title, a done state and an order, and nothing else that
-- makes a task schedulable —
--
--   never a do_date, start_time, duration, deadline
--   never a project / initiative / domain / sprint / priority of its own
--   never a recurrence, a slot, labels, or a mirror event
--
-- so it can never appear on the calendar, in the inbox, in capacity, or in the
-- funnel's rollups. The check below makes that structural rather than a
-- convention, which is the only version of it that survives contact with a
-- future feature. One level only: a step cannot have steps.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks (id) on delete cascade;

comment on column public.tasks.parent_task_id is
  'Set when this row is a STEP of another task — a checklist item, not a task. Steps are excluded from every task read (see isStep in lib/vertical.ts) and are forbidden the fields that would make them schedulable.';

create index if not exists tasks_parent_idx
  on public.tasks (parent_task_id, sort_order)
  where parent_task_id is not null;

-- A step carries none of the fields that make a task a planning object. Stated
-- here so it holds against the agent, a future import, and any surface that
-- forgets — not only against the two UIs that exist today.
alter table public.tasks drop constraint if exists tasks_step_is_not_schedulable;
alter table public.tasks add constraint tasks_step_is_not_schedulable check (
  parent_task_id is null or (
    do_date is null
    and start_time is null
    and deadline is null
    and slot_id is null
    and project_id is null
    and initiative_id is null
    and domain_id is null
    and sprint_id is null
    and big_rock_id is null
    and key_result_id is null
    and recurrence_id is null
  )
);

-- One level. A step's parent must itself be a task, never another step —
-- enforced by trigger because a CHECK cannot see another row.
create or replace function public.tasks_steps_are_flat()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.parent_task_id is null then
    return new;
  end if;
  if new.parent_task_id = new.id then
    raise exception 'a task cannot be its own step' using errcode = '23514';
  end if;
  if exists (select 1 from public.tasks t where t.id = new.parent_task_id and t.parent_task_id is not null) then
    raise exception 'steps are one level deep — a step cannot hold steps' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_steps_are_flat on public.tasks;
create trigger tasks_steps_are_flat
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.tasks_steps_are_flat();

-- Rollover must never touch a step: it has no date to roll, and the guard above
-- would reject the write anyway.
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
     and parent_task_id is null
  returning *;
end;
$$;

revoke all on function public.rollover_tasks(date) from public, anon, authenticated;
