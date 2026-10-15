-- Seed a lived-in week for the LOCAL dummy account (dummy@nuvo.test).
--
-- Local Supabase only (`supabase start`) — never run against production. Every
-- date is relative to today in America/Los_Angeles, so re-running it on any day
-- gives a fresh current week: an inbox, timed blocks, an overdue one, done work,
-- projects on and off the week (placed + loose work), sittings, a recurring
-- task, and a Google calendar with meetings in every RSVP state.
--
-- Re-runnable: it wipes this user's planner rows first. Usage:
--   scripts/local/seed-dummy.sh
do $$
declare
  uid uuid := (select id from auth.users where email = 'dummy@nuvo.test');
  tz text := 'America/Los_Angeles';
  today date := (now() at time zone 'America/Los_Angeles')::date;
  mon date := date_trunc('week', (now() at time zone 'America/Los_Angeles'))::date;
  fri date;
  d_work uuid := gen_random_uuid();
  d_family uuid := gen_random_uuid();
  d_health uuid := gen_random_uuid();
  d_side uuid := gen_random_uuid();
  i_launch uuid := gen_random_uuid();
  i_home uuid := gen_random_uuid();
  p_site uuid := gen_random_uuid();
  p_migrate uuid := gen_random_uuid();
  p_garage uuid := gen_random_uuid();
  p_talk uuid := gen_random_uuid();
  p_pricing uuid := gen_random_uuid();
  p_photos uuid := gen_random_uuid();
  sp uuid := gen_random_uuid();
  acct uuid := gen_random_uuid();
  s_site uuid := gen_random_uuid();
  s_deep uuid := gen_random_uuid();
  rec uuid := gen_random_uuid();
  l_calls uuid := gen_random_uuid();
  l_errand uuid := gen_random_uuid();
  wk int;
begin
  if uid is null then
    raise exception 'dummy@nuvo.test does not exist — run scripts/local/seed-dummy.sh';
  end if;
  fri := mon + 4;

  -- ── wipe ────────────────────────────────────────────────────────────────
  update public.user_settings set default_calendar_account_id = null where user_id = uid;
  delete from public.task_labels where task_id in (select id from public.tasks where user_id = uid);
  delete from public.tasks where user_id = uid;
  delete from public.slots where user_id = uid;
  delete from public.recurrences where user_id = uid;
  delete from public.external_events where user_id = uid;
  delete from public.calendar_accounts where user_id = uid;
  delete from public.projects where user_id = uid;
  delete from public.initiatives where user_id = uid;
  delete from public.sprints where user_id = uid;
  delete from public.labels where user_id = uid;
  delete from public.domains where user_id = uid;

  -- ── settings: onboarded, Monday weeks, a working day ──────────────────
  update public.user_settings set
    week_start = 1,
    day_start_hour = 7,
    day_end_hour = 21,
    work_start_minutes = 540,
    work_end_minutes = 1050,
    time_zone = tz,
    onboarding_completed_version = 4,
    last_rollover_date = today,
    default_task_duration_minutes = 30
  where user_id = uid;
  update public.subscriptions set status = 'active', trial_ends_at = now() + interval '365 days' where user_id = uid;

  -- ── the vertical ──────────────────────────────────────────────────────
  insert into public.domains (id, user_id, name, color, icon, sort_order, weekly_target_hours, intention) values
    (d_work, uid, 'Studio', '#4F6BD8', 'building', 1, 25, 'Ship work clients feel'),
    (d_family, uid, 'Family', '#D0567F', 'heart-handshake', 2, 8, 'Be home when home'),
    (d_health, uid, 'Health', '#2F9E6E', 'heart-pulse', 3, 5, 'Move every day'),
    (d_side, uid, 'Side project', '#C27D2E', 'sparkles', 4, 4, 'Small, steady');

  insert into public.initiatives (id, user_id, domain_id, name, outcome, status, start_date, target_date, sort_order) values
    (i_launch, uid, d_work, 'Q4 relaunch', 'New site + pricing live before Thanksgiving', 'in_progress', mon - 21, mon + 40, 1),
    (i_home, uid, d_family, 'Home reset', 'Garage usable as a workshop', 'in_progress', mon - 7, mon + 30, 2);

  -- On the week: start/target span Mon→Fri (the kernel's weekSpanFor).
  insert into public.projects (id, user_id, name, domain_id, initiative_id, status, outcome, start_date, target_date, sort_order) values
    (p_site, uid, 'Marketing site v2', d_work, i_launch, 'in_progress', 'Homepage + 3 case studies live', mon, fri, 1),
    (p_migrate, uid, 'Billing migration', d_work, i_launch, 'in_progress', 'All customers on the new plans', mon, fri, 2),
    (p_garage, uid, 'Garage clean-out', d_family, i_home, 'in_progress', 'Car fits, bench clear', mon, fri, 3),
    (p_talk, uid, 'Meetup talk', d_side, null, 'in_progress', 'Slides done, rehearsed twice', mon, fri, 4),
  -- Off the week: something to bring in.
    (p_pricing, uid, 'Pricing page experiment', d_work, i_launch, 'backlog', 'Annual toggle A/B', null, null, 5),
    (p_photos, uid, 'Family photo book', d_family, null, 'backlog', '2025 book ordered', null, null, 6);

  insert into public.sprints (id, user_id, week_start, goal) values (sp, uid, mon, 'Site live, billing cut over');

  insert into public.labels (id, user_id, name, color) values
    (l_calls, uid, 'calls', '#4F6BD8'),
    (l_errand, uid, 'errand', '#C27D2E');

  -- ── slots: a project sitting (holds work) and a domain block ─────────
  insert into public.slots (id, user_id, title, do_date, start_time, duration_minutes, project_id, domain_id) values
    (s_site, uid, '', mon + 2, ((mon + 2) + time '13:00') at time zone tz, 120, p_site, d_work),
    (s_deep, uid, 'Deep work', fri, (fri + time '09:00') at time zone tz, 120, null, d_work);

  -- ── tasks ────────────────────────────────────────────────────────────
  -- Inbox (no date, no project).
  insert into public.tasks (user_id, title, status, duration_minutes, sort_order, priority) values
    (uid, 'Reply to Dana about the venue', 'inbox', 15, 1, 'none'),
    (uid, 'Renew passport', 'inbox', 45, 2, 'high'),
    (uid, 'Look into standing desk', 'inbox', 30, 3, 'none'),
    (uid, 'Schedule dentist', 'inbox', 15, 4, 'none'),
    (uid, 'Read: "Shape Up" ch. 3', 'inbox', 30, 5, 'low'),
    (uid, 'Return the router', 'inbox', 20, 6, 'none');

  -- Today: timed blocks, anytime, one done.
  insert into public.tasks (user_id, title, status, do_date, start_time, duration_minutes, domain_id, project_id, sprint_id, completed_at, priority) values
    (uid, 'Write case study: Fernwood', 'planned', today, (today + time '09:00') at time zone tz, 90, d_work, p_site, sp, null, 'high'),
    (uid, 'Review billing cutover plan', 'planned', today, (today + time '11:30') at time zone tz, 45, d_work, p_migrate, sp, null, 'none'),
    (uid, 'Run', 'planned', today, (today + time '07:15') at time zone tz, 40, d_health, null, null, null, 'none'),
    (uid, 'Pick up kids', 'planned', today, (today + time '15:15') at time zone tz, 30, d_family, null, null, null, 'none'),
    (uid, 'Invoice October retainer', 'done', today, (today + time '08:30') at time zone tz, 15, d_work, null, null, now() - interval '2 hours', 'none'),
    (uid, 'Call the plumber', 'planned', today, null, 15, d_family, null, null, null, 'none'),
    (uid, 'Order printer ink', 'planned', today, null, 10, null, null, null, null, 'none');

  -- Earlier this week: mostly done, one left behind (overdue tint).
  for wk in 0..4 loop
    exit when mon + wk >= today;
    insert into public.tasks (user_id, title, status, do_date, start_time, duration_minutes, domain_id, completed_at) values
      (uid, 'Inbox zero', 'done', mon + wk, ((mon + wk) + time '08:00') at time zone tz, 20, d_work, ((mon + wk) + time '08:20') at time zone tz);
  end loop;
  if mon < today then
    insert into public.tasks (user_id, title, status, do_date, start_time, duration_minutes, domain_id, project_id, sprint_id) values
      (uid, 'Draft migration email to customers', 'planned', mon, (mon + time '14:00') at time zone tz, 60, d_work, p_migrate, sp);
  end if;

  -- Later this week: placed project work and personal blocks.
  insert into public.tasks (user_id, title, status, do_date, start_time, duration_minutes, domain_id, project_id, sprint_id) values
    (uid, 'Homepage hero copy', 'planned', today + 1, ((today + 1) + time '10:00') at time zone tz, 60, d_work, p_site, sp),
    (uid, 'Rehearse talk (run 1)', 'planned', today + 1, ((today + 1) + time '19:30') at time zone tz, 45, d_side, p_talk, sp),
    (uid, 'Haul boxes to donation', 'planned', today + 2, ((today + 2) + time '10:00') at time zone tz, 90, d_family, p_garage, sp);

  -- Inside the Wednesday sitting.
  insert into public.tasks (user_id, title, status, do_date, duration_minutes, domain_id, project_id, sprint_id, slot_id) values
    (uid, 'Case study photos', 'planned', mon + 2, 45, d_work, p_site, sp, s_site),
    (uid, 'Nav + footer pass', 'planned', mon + 2, 30, d_work, p_site, sp, s_site);

  -- Loose: on the week (sprint) but no time yet — the crown's amber count.
  insert into public.tasks (user_id, title, status, duration_minutes, domain_id, project_id, sprint_id, sort_order) values
    (uid, 'Case study: Northpine', 'backlog', 90, d_work, p_site, sp, 1),
    (uid, 'Redirect map for old URLs', 'backlog', 30, d_work, p_site, sp, 2),
    (uid, 'Map old plans → new plans', 'backlog', 60, d_work, p_migrate, sp, 3),
    (uid, 'Test proration on staging', 'backlog', 45, d_work, p_migrate, sp, 4),
    (uid, 'Sell the old tablesaw', 'backlog', 30, d_family, p_garage, sp, 5),
    (uid, 'Outline talk', 'backlog', 60, d_side, p_talk, sp, 6),
    (uid, 'Build demo repo', 'backlog', 90, d_side, p_talk, sp, 7);

  -- Backlog of projects NOT on the week.
  insert into public.tasks (user_id, title, status, duration_minutes, domain_id, project_id, sort_order) values
    (uid, 'Design annual toggle', 'backlog', 60, d_work, p_pricing, 1),
    (uid, 'Set up experiment flag', 'backlog', 30, d_work, p_pricing, 2),
    (uid, 'Pick 40 photos', 'backlog', 60, d_family, p_photos, 3);

  -- Labels on a couple of rows.
  insert into public.task_labels (task_id, label_id)
    select id, l_calls from public.tasks where user_id = uid and title in ('Call the plumber', 'Reply to Dana about the venue');
  insert into public.task_labels (task_id, label_id)
    select id, l_errand from public.tasks where user_id = uid and title in ('Return the router', 'Order printer ink');

  -- A weekday recurring task, materialised for this week.
  insert into public.recurrences (id, user_id, kind, freq, interval, byweekday, anchor_date, title, duration_minutes, time_of_day_minutes, domain_id, active, last_materialized)
    values (rec, uid, 'task', 'weekly', 1, array[1,2,3,4,5], mon, 'Shutdown review', 15, 1020, d_work, true, fri);
  for wk in 0..4 loop
    insert into public.tasks (user_id, title, status, do_date, start_time, duration_minutes, domain_id, recurrence_id, recurrence_date, completed_at)
      values (uid, 'Shutdown review', case when mon + wk < today then 'done' else 'planned' end::task_status,
              mon + wk, ((mon + wk) + time '17:00') at time zone tz, 15, d_work, rec, mon + wk,
              case when mon + wk < today then ((mon + wk) + time '17:15') at time zone tz end);
  end loop;

  -- ── a Google calendar (two-way, so blocks are draggable) ─────────────
  insert into public.calendar_accounts (id, user_id, provider, email, sync_direction, calendars, needs_reconnect) values
    (acct, uid, 'google', 'dummy@nuvo.test', 'two_way',
     jsonb_build_array(
       jsonb_build_object('id', 'dummy@nuvo.test', 'summary', 'Personal', 'color', '#5B7FC7', 'visible', true),
       jsonb_build_object('id', 'work@group.calendar.google.com', 'summary', 'Work', 'color', '#8E6BB8', 'visible', true)
     ), false);
  update public.user_settings
    set default_calendar_account_id = acct, default_calendar_id = 'dummy@nuvo.test'
    where user_id = uid;

  insert into public.external_events (user_id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, busy, self_rsvp, raw) values
    -- daily standup, a recurring series
    (uid, acct, 'standup_' || to_char(mon, 'YYYYMMDD'), 'work@group.calendar.google.com', 'Standup', (mon + time '09:30') at time zone tz, (mon + time '09:45') at time zone tz, false, true, 'accepted', '{"recurringEventId": "standup"}'::jsonb),
    (uid, acct, 'standup_' || to_char(mon + 1, 'YYYYMMDD'), 'work@group.calendar.google.com', 'Standup', ((mon + 1) + time '09:30') at time zone tz, ((mon + 1) + time '09:45') at time zone tz, false, true, 'accepted', '{"recurringEventId": "standup"}'::jsonb),
    (uid, acct, 'standup_' || to_char(mon + 2, 'YYYYMMDD'), 'work@group.calendar.google.com', 'Standup', ((mon + 2) + time '09:30') at time zone tz, ((mon + 2) + time '09:45') at time zone tz, false, true, 'accepted', '{"recurringEventId": "standup"}'::jsonb),
    (uid, acct, 'standup_' || to_char(mon + 3, 'YYYYMMDD'), 'work@group.calendar.google.com', 'Standup', ((mon + 3) + time '09:30') at time zone tz, ((mon + 3) + time '09:45') at time zone tz, false, true, 'accepted', '{"recurringEventId": "standup"}'::jsonb),
    (uid, acct, 'standup_' || to_char(mon + 4, 'YYYYMMDD'), 'work@group.calendar.google.com', 'Standup', ((mon + 4) + time '09:30') at time zone tz, ((mon + 4) + time '09:45') at time zone tz, false, true, 'accepted', '{"recurringEventId": "standup"}'::jsonb),
    -- one-offs, every RSVP state, an overlap with a task block today
    (uid, acct, 'ev-client', 'work@group.calendar.google.com', 'Fernwood check-in', (today + time '10:00') at time zone tz, (today + time '10:30') at time zone tz, false, true, 'accepted', null),
    (uid, acct, 'ev-lunch', 'dummy@nuvo.test', 'Lunch w/ Sam', (today + time '12:30') at time zone tz, (today + time '13:30') at time zone tz, false, true, 'tentative', null),
    (uid, acct, 'ev-design', 'work@group.calendar.google.com', 'Design crit', (mon + time '15:00') at time zone tz, (mon + time '16:00') at time zone tz, false, true, 'accepted', null),
    (uid, acct, 'ev-1on1', 'work@group.calendar.google.com', '1:1 with Priya', ((mon + 1) + time '13:00') at time zone tz, ((mon + 1) + time '13:30') at time zone tz, false, true, null, null),
    (uid, acct, 'ev-vendor', 'work@group.calendar.google.com', 'Vendor demo', ((mon + 3) + time '14:00') at time zone tz, ((mon + 3) + time '15:00') at time zone tz, false, true, 'needsAction', null),
    (uid, acct, 'ev-allhands', 'work@group.calendar.google.com', 'All-hands', ((mon + 4) + time '16:00') at time zone tz, ((mon + 4) + time '17:00') at time zone tz, false, true, 'declined', null),
    (uid, acct, 'ev-soccer', 'dummy@nuvo.test', 'Soccer practice', ((mon + 1) + time '17:30') at time zone tz, ((mon + 1) + time '18:30') at time zone tz, false, true, 'accepted', null),
    (uid, acct, 'ev-dinner', 'dummy@nuvo.test', 'Dinner at the Parks', ((mon + 5) + time '18:00') at time zone tz, ((mon + 5) + time '20:00') at time zone tz, false, true, 'accepted', null),
    (uid, acct, 'ev-offsite', 'work@group.calendar.google.com', 'Team offsite', (mon + 4)::timestamp at time zone tz, (mon + 5)::timestamp at time zone tz, true, true, 'accepted', null);

  -- `self_rsvp` is DERIVED (trg_self_rsvp, migration 18) from the attendee
  -- marked `self` in `raw`, so it can't be inserted directly — the values above
  -- are overwritten with null. Give each meeting a self-attendee with the state
  -- it should show; 1:1 with Priya stays organizer-owned (no self attendee).
  update public.external_events e
  set raw = coalesce(e.raw, '{}'::jsonb) || jsonb_build_object('attendees', jsonb_build_array(
    jsonb_build_object('email', 'dummy@nuvo.test', 'self', true, 'responseStatus', v.rsvp),
    jsonb_build_object('email', 'sam@example.com', 'responseStatus', 'accepted')
  ))
  from (values
    ('ev-client', 'accepted'), ('ev-lunch', 'tentative'), ('ev-design', 'accepted'),
    ('ev-vendor', 'needsAction'), ('ev-allhands', 'declined'), ('ev-soccer', 'accepted'),
    ('ev-dinner', 'accepted'), ('ev-offsite', 'accepted')
  ) as v(pid, rsvp)
  where e.user_id = uid and e.provider_event_id = v.pid;
  update public.external_events e
  set raw = e.raw || jsonb_build_object('attendees', jsonb_build_array(
    jsonb_build_object('email', 'dummy@nuvo.test', 'self', true, 'responseStatus', 'accepted')))
  where e.user_id = uid and e.provider_event_id like 'standup_%';

  -- Real-world descriptions: a Zoom invite as Google sends it (long dial-in
  -- list, unbroken separator and URLs) and a Teams body (rules of underscores).
  -- Exist so the event popover's handling of long / unbroken text can be seen.
  update public.external_events set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('description', 'Hi all — agenda below.<br><br>1. Recap of the pilot<br>2. Pricing tiers<br>3. Next steps<br><br>Phil is inviting you to a scheduled Zoom meeting.<br><br>Join Zoom Meeting<br><a href="https://us02web.zoom.us/j/81234567890?pwd=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwx.1">https://us02web.zoom.us/j/81234567890?pwd=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwx.1</a><br><br>Meeting ID: 812 3456 7890<br>Passcode: 482913<br><br>---<br><br>One tap mobile<br>+16694449171,,81234567890#,,,,*482913# US<br>+16699006833,,81234567890#,,,,*482913# US (San Jose)<br><br>---<br><br>Dial by your location<br>• +1 669 444 9171 US<br>• +1 669 900 6833 (San Jose) US<br>• +1 253 205 0468 US<br>• +1 253 215 8782 (Tacoma) US<br>• +1 346 248 7799 (Houston) US<br>• +1 719 359 4580 US<br>• +1 929 205 6099 (New York) US<br>• +1 301 715 8592 (Washington DC) US<br>• +1 305 224 1968 US<br>• +1 309 205 3325 US<br>• +1 312 626 6799 (Chicago) US<br>• +1 360 209 5623 US<br>• +1 386 347 5053 US<br>• +1 507 473 4847 US<br>• +1 564 217 2000 US<br>• +1 646 558 8656 (New York) US<br>• +1 646 931 3860 US<br><br>Find your local number: <a href="https://us02web.zoom.us/u/kdRtIjKlMnOpQrStUvWxYz">https://us02web.zoom.us/u/kdRtIjKlMnOpQrStUvWxYz</a><br><br>-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-<br>Invitation from Google Calendar: <a href="https://calendar.google.com/calendar/">https://calendar.google.com/calendar/</a><br><br>You are receiving this email because you are an attendee on the event. To stop receiving future updates for this event, decline this event.<br><br>Forwarding this invitation could allow any recipient to send a response to the organizer, be added to the guest list, invite others regardless of their own invitation status, or modify your RSVP. <a href="https://support.google.com/calendar/answer/37135#forwarding">Learn more</a>-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-')
    where user_id = uid and provider_event_id = 'ev-vendor';
  update public.external_events set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('description', 'Walkthrough of the new homepage.<br>________________________________________________________________________________<br>Microsoft Teams meeting<br>Join on your computer, mobile app or room device<br><a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZjE2NmQ5YzYtYzM0Ny00NjYwLWI4ZTctYjQ2Zjk5ZDJjYzE0%40thread.v2/0?context=%7b%22Tid%22%3a%2272f988bf-86f1-41af-91ab-2d7cd011db47%22%7d">Click here to join the meeting</a><br>Meeting ID: 247 512 093 781<br>Passcode: 7xQ9mT<br>Download Teams | Join on the web<br>Learn More | Meeting options<br>________________________________________________________________________________')
    where user_id = uid and provider_event_id = 'ev-design';
end $$;
