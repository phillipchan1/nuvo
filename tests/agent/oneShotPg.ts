// PGlite for the agent one-shot tests: the isolation schema (worker/schema/
// neon.sql + seed) plus the columns prod Neon has that the rehearsal neon.sql
// doesn't yet (read from prod's information_schema on 2026-11-13; names and
// types only). The one-shots select them, as they did on Supabase.
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "../../worker/src/isolationDb.ts";

const PROD_COLUMNS = `
  ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS context_at TIMESTAMPTZ;
  ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''::text;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS start_date DATE;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS momentum TEXT NOT NULL DEFAULT 'flat'::text;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS tended_at TIMESTAMPTZ;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS verification JSONB;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS brief JSONB;
  ALTER TABLE public.initiatives ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.key_results ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  ALTER TABLE public.key_results ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''::text;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS start_date DATE;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS tended_at TIMESTAMPTZ;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS verification JSONB;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS key_result_id UUID;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS brief JSONB;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS energy TEXT;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sprint_id UUID;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS initiative_id UUID;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignee TEXT NOT NULL DEFAULT 'me'::text;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS prework TEXT NOT NULL DEFAULT ''::text;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS prework_at TIMESTAMPTZ;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_id UUID;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_date DATE;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_overridden BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS big_rock_id TEXT;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS suggestion JSONB;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS suggested_at TIMESTAMPTZ;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS key_result_id UUID;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS calendar_fit_hours INTEGER NOT NULL DEFAULT 13;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS calendar_domain_map JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS show_weather BOOLEAN DEFAULT false;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS default_calendar_account_id UUID;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS onboarding_completed_version INTEGER;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS auto_add_meet TEXT NOT NULL DEFAULT 'guests'::text;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS saved_views JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS default_task_duration_minutes INTEGER NOT NULL DEFAULT 30;
  ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS default_calendar_id TEXT;
`;

export async function oneShotPg(): Promise<PGlite> {
  const db = new PGlite();
  await applyIsolationSchema(db);
  await db.exec(PROD_COLUMNS);
  return db;
}
