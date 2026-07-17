-- Heal slot children whose do_date drifted from (or never received) the slot's day.
--
-- Tasks inside a slot ride the slot's calendar block: start_time is null on the
-- child, and do_date should match slots.do_date. The left rail already resolves
-- "when" from the slot, but WeekBoard / weekReadiness only looked at the task
-- row — so a moved slot left children looking "unplaced" (Needs a day / docked).
-- Writers now keep them in lockstep; this pass corrects existing rows.

update tasks t
   set do_date = s.do_date
  from slots s
 where t.slot_id = s.id
   and t.status <> 'trashed'
   and t.do_date is distinct from s.do_date;
