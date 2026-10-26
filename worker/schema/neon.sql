-- Neon planner schema for the Workers rehearsal.
-- Not a replay of supabase/migrations (those assume auth.users, vault,
-- realtime, pg_cron). This is the dual-pathable subset: owner is
-- public.users(id), and the Worker enforces user_id on every query.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  -- Better Auth user id. Lookup this first so an email change does not
  -- insert a second empty planner row. Unique: one BA user ↔ one users row.
  auth_id UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fresh CREATE above already has auth_id. Re-applying on an older rehearsal
-- DB still picks the column up.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  intention TEXT NOT NULL DEFAULT '',
  weekly_target_hours NUMERIC,
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  domain_id UUID REFERENCES public.domains (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain_id UUID REFERENCES public.domains (id) ON DELETE SET NULL,
  initiative_id UUID REFERENCES public.initiatives (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  outcome TEXT NOT NULL DEFAULT '',
  target_date DATE,
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.key_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL REFERENCES public.initiatives (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  baseline_value NUMERIC NOT NULL DEFAULT 0,
  current_value NUMERIC NOT NULL DEFAULT 0,
  target_value NUMERIC NOT NULL DEFAULT 100,
  unit TEXT NOT NULL DEFAULT '%',
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563EB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT NOT NULL DEFAULT '',
  do_date DATE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  project_id UUID REFERENCES public.projects (id) ON DELETE SET NULL,
  domain_id UUID REFERENCES public.domains (id) ON DELETE SET NULL,
  color TEXT,
  google_event_id TEXT
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inbox',
  do_date DATE,
  start_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  deadline DATE,
  priority TEXT NOT NULL DEFAULT 'none',
  roll_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  trashed_at TIMESTAMPTZ,
  project_id UUID REFERENCES public.projects (id) ON DELETE SET NULL,
  domain_id UUID REFERENCES public.domains (id) ON DELETE SET NULL,
  slot_id UUID REFERENCES public.slots (id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES public.tasks (id) ON DELETE CASCADE,
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.task_labels (
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES public.labels (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS public.recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'task',
  rrule TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system',
  day_start_hour INTEGER NOT NULL DEFAULT 6,
  day_end_hour INTEGER NOT NULL DEFAULT 23,
  week_start INTEGER NOT NULL DEFAULT 1,
  hidden_calendar_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  inbound_token TEXT UNIQUE,
  last_rollover_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  UNIQUE (user_id, week_start)
);

CREATE TABLE IF NOT EXISTS public.week_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, week_start)
);

CREATE TABLE IF NOT EXISTS public.record_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects (id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES public.initiatives (id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL DEFAULT 'task',
  target_id UUID,
  anchor TEXT NOT NULL DEFAULT 'start',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reminder_deliveries (
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, reminder_key, fire_at)
);

CREATE TABLE IF NOT EXISTS public.event_domain_routing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  domain_id UUID REFERENCES public.domains (id) ON DELETE SET NULL,
  UNIQUE (user_id, event_key)
);

CREATE TABLE IF NOT EXISTS public.contacts_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT
);

CREATE INDEX IF NOT EXISTS tasks_user_status_idx ON public.tasks (user_id, status, do_date);
CREATE INDEX IF NOT EXISTS domains_user_idx ON public.domains (user_id);
CREATE INDEX IF NOT EXISTS projects_user_idx ON public.projects (user_id);

-- ── PR D: mirrors + push (additive; PR A owns the token-seal columns) ────
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS reminder_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS time_zone TEXT;
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS hidden_events JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS event_key TEXT;
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS leads INTEGER[] NOT NULL DEFAULT '{}'::integer[];

ALTER TABLE public.reminder_deliveries
  ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE public.reminder_deliveries
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.calendar_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token_secret_id UUID,
  -- PR A: sealed refresh / app-password. Never logged.
  refresh_token_enc BYTEA,
  refresh_token_iv BYTEA,
  key_version SMALLINT,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  sync_direction TEXT NOT NULL DEFAULT 'two_way',
  calendars JSONB NOT NULL DEFAULT '[]'::jsonb,
  mirror_calendar_id TEXT,
  needs_reconnect BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email)
);

CREATE TABLE IF NOT EXISTS public.external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.calendar_accounts (id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '(no title)',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  location TEXT,
  busy BOOLEAN NOT NULL DEFAULT TRUE,
  self_rsvp TEXT,
  recurring_event_id TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, calendar_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS external_events_user_range_idx
  ON public.external_events (user_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  time_zone TEXT,
  last_seen_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.sync_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES public.users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
