-- Initiative status vocabulary: adopt the project set
-- (backlog → in_progress → waiting / cancelled / complete), replacing
-- active / paused / shipped / dropped so initiatives and projects agree.

update public.initiatives
  set status = case status
    when 'active' then 'in_progress'
    when 'paused' then 'waiting'
    when 'shipped' then 'complete'
    when 'dropped' then 'cancelled'
    else status
  end
  where status in ('active', 'paused', 'shipped', 'dropped');

-- A new bet is one you're placing now, so it lands in flight (not the backlog
-- a fresh project starts in).
alter table public.initiatives
  alter column status set default 'in_progress';
