-- D-147: roll_count counts DAYS carried, not rollover runs.
--
-- It added 1 per run, and one run can move work several days: a task missed
-- on Tuesday and rolled on Thursday (a skipped night, or D-145 carrying a
-- recurring occurrence for the first time) read "↻1" while two days late. The
-- badge is read as "how long has this been hanging", so it adds the gap.
--
-- Otherwise identical to migration 84.
create or replace function public.rollover_tasks(p_today date)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.tasks t
     set do_date = p_today,
         start_time = null,
         slot_id = null,
         roll_count = t.roll_count + (p_today - d.eff_date),
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
