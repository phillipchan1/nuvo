-- Two synthetic operators. No production data.
-- A cannot see or mutate B.

INSERT INTO public.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

INSERT INTO public.user_settings (user_id, theme) VALUES
  ('11111111-1111-1111-1111-111111111111', 'light'),
  ('22222222-2222-2222-2222-222222222222', 'dark');

INSERT INTO public.domains (id, user_id, name, color) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Work', '#2563EB'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'B Work', '#DB2777');

INSERT INTO public.projects (id, user_id, name, domain_id) VALUES
  ('aaaaaaaa-1111-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Project', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-1111-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'B Project', 'bbbbbbbb-0000-4000-8000-000000000001');

INSERT INTO public.tasks (id, user_id, title, notes, status, project_id, do_date, start_time) VALUES
  ('aaaaaaaa-2222-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'A only task', 'private A', 'planned', 'aaaaaaaa-1111-4000-8000-000000000001', '2026-10-26', '2026-10-26T10:00:00Z'),
  ('bbbbbbbb-2222-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'B only task', 'private B', 'planned', 'bbbbbbbb-1111-4000-8000-000000000001', '2026-10-26', '2026-10-26T10:00:00Z');

INSERT INTO public.labels (id, user_id, name) VALUES
  ('aaaaaaaa-3333-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'A tag'),
  ('bbbbbbbb-3333-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'B tag');

INSERT INTO public.task_labels (task_id, label_id) VALUES
  ('aaaaaaaa-2222-4000-8000-000000000001', 'aaaaaaaa-3333-4000-8000-000000000001'),
  ('bbbbbbbb-2222-4000-8000-000000000001', 'bbbbbbbb-3333-4000-8000-000000000001');

INSERT INTO public.reminders (id, user_id, target_kind, target_id) VALUES
  ('aaaaaaaa-4444-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'task', 'aaaaaaaa-2222-4000-8000-000000000001'),
  ('bbbbbbbb-4444-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'task', 'bbbbbbbb-2222-4000-8000-000000000001');

INSERT INTO public.contacts_directory (id, user_id, email, name) VALUES
  ('aaaaaaaa-5555-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'friend-a@example.test', 'Friend A'),
  ('bbbbbbbb-5555-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'friend-b@example.test', 'Friend B');

INSERT INTO public.sprints (id, user_id, week_start) VALUES
  ('aaaaaaaa-6666-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-10-26'),
  ('bbbbbbbb-6666-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-10-26');

INSERT INTO public.initiatives (id, user_id, domain_id, name) VALUES
  ('aaaaaaaa-7777-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'A Initiative'),
  ('bbbbbbbb-7777-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000001', 'B Initiative');

INSERT INTO public.key_results (id, user_id, initiative_id, name) VALUES
  ('aaaaaaaa-8888-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-7777-4000-8000-000000000001', 'A KR'),
  ('bbbbbbbb-8888-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-7777-4000-8000-000000000001', 'B KR');

INSERT INTO public.slots (id, user_id, title, do_date, start_time, duration_minutes) VALUES
  ('aaaaaaaa-9999-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'A slot', '2026-10-26', '2026-10-26T09:00:00Z', 60),
  ('bbbbbbbb-9999-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'B slot', '2026-10-26', '2026-10-26T09:00:00Z', 60);

INSERT INTO public.recurrences (id, user_id, kind, rrule) VALUES
  ('aaaaaaaa-aaaa-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'task', 'FREQ=WEEKLY'),
  ('bbbbbbbb-aaaa-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'task', 'FREQ=DAILY');

INSERT INTO public.record_comments (id, user_id, project_id, body) VALUES
  ('aaaaaaaa-bbbb-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-4000-8000-000000000001', 'A note'),
  ('bbbbbbbb-bbbb-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1111-4000-8000-000000000001', 'B note');

INSERT INTO public.week_reviews (id, user_id, week_start) VALUES
  ('aaaaaaaa-cccc-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-10-26'),
  ('bbbbbbbb-cccc-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-10-26');

INSERT INTO public.event_domain_routing (id, user_id, event_key, domain_id) VALUES
  ('aaaaaaaa-dddd-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'evt-a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-dddd-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'evt-b', 'bbbbbbbb-0000-4000-8000-000000000001');
