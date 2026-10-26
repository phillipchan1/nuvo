-- Neon planner schema for the Workers rehearsal.
-- Not a replay of supabase/migrations (those assume auth.users, vault,
-- realtime, pg_cron). This is the dual-pathable subset: owner is
-- public.users(id), and the Worker enforces user_id on every query.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
