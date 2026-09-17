-- Rollover keeps the clock. A scheduled task IS a time block (P1): stripping
-- start_time on roll made Sunday's 2pm vanish from Tuesday's grid and dump the
-- work into the anytime pile, which is how unfinished day-work got forgotten
-- even though the date had moved. Untimed work still just changes day.
--
-- Also restores the slot join from migration 19 that migration 60 dropped
-- when it rewrote this function for steps: a task inside a passed slot still
-- has to leave that slot, and it inherits the slot's clock so it stays visible.
-- Recurring occurrences still never roll (D-009). Steps still never roll.

create or replace function public.rollover_tasks(p_today date)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.tasks t
     set do_date = p_today,
         start_time = case
           when t.start_time is not null then
             t.start_time + (p_today - d.eff_date) * interval '1 day'
           when d.slot_start is not null then
             d.slot_start + (p_today - d.eff_date) * interval '1 day'
           else
             null
         end,
         slot_id = null,
         roll_count = t.roll_count + 1,
         status = 'planned'
    from (
      select tk.id,
             coalesce(s.do_date, tk.do_date) as eff_date,
             s.start_time as slot_start
        from public.tasks tk
        left join public.slots s on s.id = tk.slot_id
    ) d
   where t.id = d.id
     and t.status in ('inbox', 'planned')
     and d.eff_date is not null
     and d.eff_date < p_today
     and t.recurrence_id is null
     and t.parent_task_id is null
  returning t.*;
end;
$$;

revoke all on function public.rollover_tasks(date) from public, anon, authenticated;
