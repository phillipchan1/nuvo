-- D-145: a missed recurring occurrence carries to today until the series' next
-- occurrence comes due.
--
-- D-009 skipped every recurring occurrence on the grounds that "tomorrow
-- already has its own". That is only true of a daily series. A weekly "Write"
-- missed on Tuesday had nothing standing in for it until next Monday, so it
-- stayed stranded on Tuesday's grid and never reached the Today list.
--
-- The rule now: an open occurrence rolls unless the same series already has a
-- LATER occurrence (by recurrence_date, the rule's own date) that has come due
-- by today. Daily habits still never pile up (today's occurrence supersedes
-- yesterday's), and at most one occurrence per series is ever carried.
--
-- Identity is (recurrence_id, recurrence_date), not do_date, so moving the
-- date does not make the materialiser re-create the occurrence. A carried
-- occurrence is pinned (recurrence_overridden) so an "edit all" regeneration,
-- which clears non-overridden rows dated today onward, leaves it alone.
create or replace function public.rollover_tasks(p_today date)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.tasks t
     set do_date = p_today,
         start_time = null,
         slot_id = null,
         roll_count = t.roll_count + 1,
         recurrence_overridden = t.recurrence_overridden or t.recurrence_id is not null,
         status = 'planned'
    from (
      select tk.id,
             coalesce(s.do_date, tk.do_date) as eff_date
        from public.tasks tk
        left join public.slots s on s.id = tk.slot_id
    ) d
   where t.id = d.id
     and t.status in ('inbox', 'planned')
     and d.eff_date is not null
     and d.eff_date < p_today
     and t.parent_task_id is null
     and (
       t.recurrence_id is null
       or not exists (
         select 1
           from public.tasks nx
          where nx.recurrence_id = t.recurrence_id
            and nx.recurrence_date > t.recurrence_date
            and nx.recurrence_date <= p_today
            and nx.status <> 'trashed'
       )
     )
  returning t.*;
end;
$$;
revoke all on function public.rollover_tasks(date) from public, anon, authenticated;
