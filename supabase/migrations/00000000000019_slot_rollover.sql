-- Rollover + slots: a task living inside a slot rides the slot's day, not its
-- own (possibly stale) do_date. The original rollover keyed only on the task's
-- do_date and left slot_id untouched, so an unfinished slot task stayed pinned
-- inside its now-past slot instead of carrying forward like every other task.
--
-- Fix: measure each task against its *effective* day — the slot's do_date when
-- it's in a slot, else its own — and on rollover detach it from the passed slot
-- (slot_id = null) so it lands on today as a normal un-slotted planned task,
-- keeping its duration and gaining a roll count. Recurring occurrences are
-- still never rolled (tomorrow already has a fresh one).
create or replace function public.rollover_tasks(p_today date)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.tasks t
     set do_date = p_today,
         start_time = null,
         slot_id = null,
         roll_count = t.roll_count + 1,
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
     and t.recurrence_id is null
  returning t.*;
end;
$$;

revoke all on function public.rollover_tasks(date) from public, anon, authenticated;
