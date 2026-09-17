-- D-141: a rolled task lands in anytime, not on yesterday's hour.
-- D-140 kept the clock; the new day's grid does not fit that hour, and the
-- blocks stacked on top of today's real schedule. Clearing start_time puts
-- them in the all-day ("anytime") row until the user places them again.
--
-- Slot children still leave the passed slot (migration 19). They do not
-- inherit the slot's clock — that would pin them to yesterday's window too.
-- Recurring occurrences still never roll (D-009). Steps still never roll.

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
     and t.parent_task_id is null
  returning t.*;
end;
$$;

revoke all on function public.rollover_tasks(date) from public, anon, authenticated;

-- Un-pin D-140's keep-clock: open rolled work that still has a time belongs in
-- anytime until the user places it. Recurring occurrences are left alone.
update public.tasks
   set start_time = null
 where status in ('inbox', 'planned')
   and roll_count > 0
   and start_time is not null
   and recurrence_id is null
   and parent_task_id is null
   and trashed_at is null;
