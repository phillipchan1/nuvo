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

ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS charter TEXT NOT NULL DEFAULT '';
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS context JSONB;
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS icon TEXT;

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS work_start_minutes INTEGER NOT NULL DEFAULT 480;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS work_end_minutes INTEGER NOT NULL DEFAULT 990;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS hidden_events JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.event_domain_routing ADD COLUMN IF NOT EXISTS confidence NUMERIC;
ALTER TABLE public.event_domain_routing ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ;

ALTER TABLE public.sprints ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE public.sprints ADD COLUMN IF NOT EXISTS big_rocks JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;

CREATE TABLE IF NOT EXISTS public.connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  app TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['inbox:write']::text[],
  token_hash TEXT NOT NULL UNIQUE,
  last_four TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS connections_user_idx ON public.connections (user_id);
CREATE INDEX IF NOT EXISTS connections_token_hash_active_idx
  ON public.connections (token_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES public.connections (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_connection_external_id_idx
  ON public.tasks (connection_id, external_id)
  WHERE connection_id IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inbound_emails (
  email_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks (id) ON DELETE SET NULL,
  from_address TEXT,
  subject TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_emails_user_idx ON public.inbound_emails (user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  busy BOOLEAN NOT NULL DEFAULT TRUE,
  location TEXT,
  calendar_id TEXT,
  account_id UUID,
  provider_event_id TEXT,
  recurring_event_id TEXT
);

CREATE INDEX IF NOT EXISTS external_events_user_idx ON public.external_events (user_id, start_at);

CREATE INDEX IF NOT EXISTS tasks_user_status_idx ON public.tasks (user_id, status, do_date);
CREATE INDEX IF NOT EXISTS domains_user_idx ON public.domains (user_id);
CREATE INDEX IF NOT EXISTS projects_user_idx ON public.projects (user_id);
