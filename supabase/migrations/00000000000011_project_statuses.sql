-- Project status vocabulary: backlog → in_progress → waiting / cancelled / complete
-- (replaces planned / active / blocked / done).

update public.projects
  set status = case status
    when 'planned' then 'backlog'
    when 'active' then 'in_progress'
    when 'blocked' then 'waiting'
    when 'done' then 'complete'
    else status
  end
  where status in ('planned', 'active', 'blocked', 'done');

alter table public.projects
  alter column status set default 'backlog';
