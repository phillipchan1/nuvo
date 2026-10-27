-- Neon planner schema for the Workers rehearsal.
-- Not a replay of supabase/migrations (those assume auth.users, vault,
-- realtime, pg_cron). Owner is public.users(id); the Worker enforces
-- user_id on every query. Includes planner tables plus the blocked-route
-- set (calendar / push / activity / identity / ingest) and AES-GCM token
-- columns. Vault secret ids stay nullable and unused on Neon.

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

-- Columns later ports (#98 and calendar routes) already read. Additive so a
-- rehearsal DB that ran an older neon.sql still picks them up.
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS charter TEXT NOT NULL DEFAULT '';
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS context JSONB;
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS icon TEXT;

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS work_start_minutes INTEGER NOT NULL DEFAULT 480;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS work_end_minutes INTEGER NOT NULL DEFAULT 990;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS hidden_events JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS time_zone TEXT;

ALTER TABLE public.event_domain_routing ADD COLUMN IF NOT EXISTS confidence NUMERIC;
ALTER TABLE public.event_domain_routing ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ;

ALTER TABLE public.sprints ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE public.sprints ADD COLUMN IF NOT EXISTS big_rocks JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;

ALTER TABLE public.reminder_deliveries ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.reminder_deliveries ADD COLUMN IF NOT EXISTS channel TEXT;

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS reminder_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS event_key TEXT;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS leads INTEGER[] NOT NULL DEFAULT '{}'::integer[];

-- ---------------------------------------------------------------------------
-- Blocked-route tables (calendar / push / activity / identity / ingest).
-- Owner is public.users(id). The Worker scopes every query by user_id.
-- Refresh tokens / PATs / app passwords / ICS URLs live in
-- refresh_token_enc + refresh_token_iv + key_version (AES-GCM). The
-- *_secret_id columns stay nullable for cutover traceability and are
-- never read on Neon.
-- ---------------------------------------------------------------------------

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

CREATE TABLE IF NOT EXISTS public.calendar_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token_secret_id UUID,
  refresh_token_enc BYTEA,
  refresh_token_iv BYTEA,
  key_version SMALLINT,
  access_token TEXT,
  access_token_enc BYTEA,
  access_token_iv BYTEA,
  access_token_expires_at TIMESTAMPTZ,
  sync_direction TEXT NOT NULL DEFAULT 'read_only',
  calendars JSONB NOT NULL DEFAULT '[]'::jsonb,
  webhook_channel_id TEXT,
  webhook_resource_id TEXT,
  webhook_expires_at TIMESTAMPTZ,
  delta_link TEXT,
  mirror_calendar_id TEXT,
  needs_reconnect BOOLEAN NOT NULL DEFAULT FALSE,
  next_sync_at TIMESTAMPTZ,
  sync_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email)
);

-- Isolation is owner-scoped SQL in the Worker (`user_id = session`), not
-- Postgres RLS. The Worker uses a privileged connection; generic /api/data
-- does not expose this table (token columns). prove-isolation-mutation
-- deletes those WHERE clauses.
CREATE INDEX IF NOT EXISTS calendar_accounts_user_idx ON public.calendar_accounts (user_id);
CREATE INDEX IF NOT EXISTS calendar_accounts_due_idx
  ON public.calendar_accounts (next_sync_at)
  WHERE NOT needs_reconnect;

CREATE TABLE IF NOT EXISTS public.external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.calendar_accounts (id) ON DELETE CASCADE,
  provider_event_id TEXT,
  calendar_id TEXT,
  title TEXT NOT NULL DEFAULT '(no title)',
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  location TEXT,
  busy BOOLEAN NOT NULL DEFAULT TRUE,
  raw JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT,
  self_rsvp TEXT,
  recurring_event_id TEXT
);

-- Re-apply on a thinner table (PR #98) picks the sync columns up.
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.calendar_accounts (id) ON DELETE CASCADE;
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS provider_event_id TEXT;
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS calendar_id TEXT;
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS raw JSONB;
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS self_rsvp TEXT;
ALTER TABLE public.external_events ADD COLUMN IF NOT EXISTS recurring_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS external_events_account_cal_event_uidx
  ON public.external_events (account_id, calendar_id, provider_event_id)
  WHERE account_id IS NOT NULL AND calendar_id IS NOT NULL AND provider_event_id IS NOT NULL;
-- Non-partial twin so ON CONFLICT (account_id, calendar_id, provider_event_id) can infer a target.
CREATE UNIQUE INDEX IF NOT EXISTS external_events_account_cal_event_conflict_uidx
  ON public.external_events (account_id, calendar_id, provider_event_id);
CREATE INDEX IF NOT EXISTS external_events_user_range_idx
  ON public.external_events (user_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS external_events_user_idx ON public.external_events (user_id, start_at);

CREATE TABLE IF NOT EXISTS public.sync_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES public.users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_log_user_idx ON public.sync_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_log_created_at_idx ON public.sync_log (created_at DESC);

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

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.activity_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'github',
  login TEXT,
  avatar_url TEXT,
  token_secret_id UUID,
  refresh_token_enc BYTEA,
  refresh_token_iv BYTEA,
  key_version SMALLINT,
  repos JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_reconnect BOOLEAN NOT NULL DEFAULT FALSE,
  cursor TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, login)
);

CREATE INDEX IF NOT EXISTS activity_sources_user_idx ON public.activity_sources (user_id);

CREATE TABLE IF NOT EXISTS public.activity_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.activity_sources (id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  selector TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, selector)
);

CREATE INDEX IF NOT EXISTS activity_bindings_user_idx ON public.activity_bindings (user_id);

CREATE TABLE IF NOT EXISTS public.activity_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.activity_sources (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'github',
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  selector TEXT,
  project_id UUID REFERENCES public.projects (id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS activity_units_user_occurred ON public.activity_units (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_units_project ON public.activity_units (project_id);

CREATE TABLE IF NOT EXISTS public.apple_identities (
  user_id UUID PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  apple_user_id TEXT,
  email TEXT,
  given_name TEXT,
  family_name TEXT,
  is_private_relay BOOLEAN NOT NULL DEFAULT FALSE,
  refresh_token_secret_id UUID,
  refresh_token_enc BYTEA,
  refresh_token_iv BYTEA,
  key_version SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS apple_identities_apple_user_id_uidx
  ON public.apple_identities (apple_user_id)
  WHERE apple_user_id IS NOT NULL;

-- Encrypted-token columns on a DB that already had the tables (cutover restore).
ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS refresh_token_enc BYTEA;
ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS refresh_token_iv BYTEA;
ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS key_version SMALLINT;
ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS access_token_enc BYTEA;
ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS access_token_iv BYTEA;
ALTER TABLE public.contacts_directory ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.calendar_accounts (id) ON DELETE CASCADE;
ALTER TABLE public.contacts_directory ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.contacts_directory ADD COLUMN IF NOT EXISTS display_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_directory_account_email_uidx
  ON public.contacts_directory (account_id, email);
ALTER TABLE public.activity_sources ADD COLUMN IF NOT EXISTS refresh_token_enc BYTEA;
ALTER TABLE public.activity_sources ADD COLUMN IF NOT EXISTS refresh_token_iv BYTEA;
ALTER TABLE public.activity_sources ADD COLUMN IF NOT EXISTS key_version SMALLINT;
ALTER TABLE public.apple_identities ADD COLUMN IF NOT EXISTS refresh_token_enc BYTEA;
ALTER TABLE public.apple_identities ADD COLUMN IF NOT EXISTS refresh_token_iv BYTEA;
ALTER TABLE public.apple_identities ADD COLUMN IF NOT EXISTS key_version SMALLINT;
