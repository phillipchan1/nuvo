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

INSERT INTO public.calendar_accounts (
  id, user_id, provider, email, access_token, access_token_expires_at,
  sync_direction, calendars, needs_reconnect
) VALUES
  (
    'aaaaaaaa-eeee-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'google',
    'a-cal@example.test',
    'ya29.a-access',
    '2099-01-01T00:00:00Z',
    'two_way',
    '[{"id":"cal-a@group.calendar.google.com","summary":"A Cal","color":null,"visible":true,"channel_id":"ch-a","resource_id":"res-a"}]'::jsonb,
    false
  ),
  (
    'bbbbbbbb-eeee-4000-8000-000000000001',
    '22222222-2222-2222-2222-222222222222',
    'google',
    'b-cal@example.test',
    'ya29.b-access',
    '2099-01-01T00:00:00Z',
    'two_way',
    '[{"id":"cal-b@group.calendar.google.com","summary":"B Cal","color":null,"visible":true,"channel_id":"ch-b","resource_id":"res-b"}]'::jsonb,
    false
  ),
  (
    'aaaaaaaa-eeee-4000-8000-000000000011',
    '11111111-1111-1111-1111-111111111111',
    'm365',
    'a-m365@example.test',
    NULL,
    NULL,
    'read_only',
    '[{"id":"primary","summary":"A Outlook","color":null,"visible":true}]'::jsonb,
    false
  ),
  (
    'bbbbbbbb-eeee-4000-8000-000000000011',
    '22222222-2222-2222-2222-222222222222',
    'm365',
    'b-m365@example.test',
    NULL,
    NULL,
    'read_only',
    '[{"id":"primary","summary":"B Outlook","color":null,"visible":true}]'::jsonb,
    false
  ),
  (
    'aaaaaaaa-eeee-4000-8000-000000000012',
    '11111111-1111-1111-1111-111111111111',
    'icloud',
    'a-icloud@example.test',
    NULL,
    NULL,
    'two_way',
    '[{"id":"https://caldav.example/a","summary":"A iCloud","color":null,"visible":true}]'::jsonb,
    false
  ),
  (
    'bbbbbbbb-eeee-4000-8000-000000000012',
    '22222222-2222-2222-2222-222222222222',
    'icloud',
    'b-icloud@example.test',
    NULL,
    NULL,
    'two_way',
    '[{"id":"https://caldav.example/b","summary":"B iCloud","color":null,"visible":true}]'::jsonb,
    false
  ),
  (
    'aaaaaaaa-eeee-4000-8000-000000000013',
    '11111111-1111-1111-1111-111111111111',
    'ics',
    'A subscribed',
    NULL,
    NULL,
    'read_only',
    '[{"id":"primary","summary":"A ICS","color":null,"visible":true}]'::jsonb,
    false
  ),
  (
    'bbbbbbbb-eeee-4000-8000-000000000013',
    '22222222-2222-2222-2222-222222222222',
    'ics',
    'B subscribed',
    NULL,
    NULL,
    'read_only',
    '[{"id":"primary","summary":"B ICS","color":null,"visible":true}]'::jsonb,
    false
  );

INSERT INTO public.external_events (
  id, user_id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, busy
) VALUES
  (
    'aaaaaaaa-ffff-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-eeee-4000-8000-000000000001',
    'evt-a-1',
    'cal-a@group.calendar.google.com',
    'A private event',
    '2026-10-26T17:00:00Z',
    '2026-10-26T18:00:00Z',
    false,
    true
  ),
  (
    'bbbbbbbb-ffff-4000-8000-000000000001',
    '22222222-2222-2222-2222-222222222222',
    'bbbbbbbb-eeee-4000-8000-000000000001',
    'evt-b-1',
    'cal-b@group.calendar.google.com',
    'B private event',
    '2026-10-26T17:00:00Z',
    '2026-10-26T18:00:00Z',
    false,
    true
  );

INSERT INTO public.push_subscriptions (id, user_id, endpoint, p256dh, auth, label) VALUES
  ('aaaaaaaa-0101-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'https://push.example/a', 'p256-a', 'auth-a', 'A phone'),
  ('bbbbbbbb-0101-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'https://push.example/b', 'p256-b', 'auth-b', 'B phone');

INSERT INTO public.activity_sources (id, user_id, kind, login) VALUES
  ('aaaaaaaa-0202-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'github', 'user-a'),
  ('bbbbbbbb-0202-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'github', 'user-b');

INSERT INTO public.activity_bindings (id, user_id, source_id, project_id, selector) VALUES
  ('aaaaaaaa-0303-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0202-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001', 'phil/a'),
  ('bbbbbbbb-0303-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0202-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000001', 'phil/b');

INSERT INTO public.activity_units (id, user_id, source_id, kind, external_id, title, occurred_at, project_id) VALUES
  ('aaaaaaaa-0404-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0202-4000-8000-000000000001', 'github', 'PR_A', 'A shipped', '2026-10-26T12:00:00Z', 'aaaaaaaa-1111-4000-8000-000000000001'),
  ('bbbbbbbb-0404-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0202-4000-8000-000000000001', 'github', 'PR_B', 'B shipped', '2026-10-26T12:00:00Z', 'bbbbbbbb-1111-4000-8000-000000000001');

INSERT INTO public.apple_identities (user_id, apple_user_id, email, is_private_relay) VALUES
  ('11111111-1111-1111-1111-111111111111', 'apple-sub-a', 'a@privaterelay.appleid.com', TRUE),
  ('22222222-2222-2222-2222-222222222222', 'apple-sub-b', 'b@privaterelay.appleid.com', TRUE);

INSERT INTO public.connections (id, user_id, app, name, token_hash, last_four) VALUES
  ('aaaaaaaa-0505-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'lead_well', 'A app', 'hash-a', 'aaa1'),
  ('bbbbbbbb-0505-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'lead_well', 'B app', 'hash-b', 'bbb2');

INSERT INTO public.inbound_emails (email_id, user_id, subject) VALUES
  ('email-a-1', '11111111-1111-1111-1111-111111111111', 'A inbound'),
  ('email-b-1', '22222222-2222-2222-2222-222222222222', 'B inbound');

INSERT INTO public.sync_log (user_id, provider, operation, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'google', 'sync', 'ok'),
  ('22222222-2222-2222-2222-222222222222', 'google', 'sync', 'ok');
