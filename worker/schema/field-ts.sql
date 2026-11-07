-- Per-field last-write-wins for every server writer on Neon (blocker 7,
-- docs/cloudflare-cutover.md). The ONE definition of "a server write stamps
-- field_ts": applied by the copy (cutover-migrate.yml, after pg_restore,
-- which drops every trigger and function) and by apply-neon-schema.mjs.
--
-- Same function and trigger names as Supabase migration 65, same body: the
-- SPA always writes value + stamp together (rest.ts, apply_patch), so this
-- stamps a column only when its VALUE changed and its STAMP did not — the
-- agent / MCP / capture / inbound / rollover / mirror case. Without it an
-- older offline edit beats a newer server write, because the server write
-- left the field's stamp where it was.
--
-- A trigger rather than a helper threaded through each statement: the Worker
-- has ~40 hand-written writes to these tables across store.ts, cronJobs.ts,
-- captureHttp.ts, inboundHttp.ts, agentExec.ts and the mirrors, and the next
-- one would forget. Tables without a field_ts column (a fresh neon.sql) are
-- skipped, so this is safe to apply anywhere, any number of times.

CREATE OR REPLACE FUNCTION public.stamp_unstamped_field_ts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  col text;
  old_ts jsonb := '{}'::jsonb;
  new_ts jsonb;
  skip CONSTANT text[] := ARRAY['field_ts', 'id', 'user_id', 'created_at', 'updated_at'];
  old_row jsonb;
  new_row jsonb := to_jsonb(NEW);
BEGIN
  new_ts := coalesce(NEW.field_ts, '{}'::jsonb);

  IF TG_OP = 'INSERT' THEN
    FOR col IN SELECT jsonb_object_keys(new_row)
    LOOP
      IF col = ANY (skip) THEN CONTINUE; END IF;
      IF new_row -> col IS NULL OR new_row -> col = 'null'::jsonb THEN CONTINUE; END IF;
      IF new_ts ->> col IS NULL THEN
        new_ts := new_ts || jsonb_build_object(col, now());
      END IF;
    END LOOP;
    NEW.field_ts := new_ts;
    RETURN NEW;
  END IF;

  old_ts := coalesce(OLD.field_ts, '{}'::jsonb);
  old_row := to_jsonb(OLD);
  FOR col IN SELECT jsonb_object_keys(new_row)
  LOOP
    IF col = ANY (skip) THEN CONTINUE; END IF;
    IF new_row -> col IS NOT DISTINCT FROM old_row -> col THEN CONTINUE; END IF;
    IF new_ts ->> col IS NOT DISTINCT FROM old_ts ->> col THEN
      new_ts := new_ts || jsonb_build_object(col, now());
    END IF;
  END LOOP;
  NEW.field_ts := new_ts;
  RETURN NEW;
END;
$$;

DO $stamp$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks',
    'slots',
    'projects',
    'initiatives',
    'domains',
    'key_results',
    'labels',
    'user_settings',
    'record_comments',
    'week_reviews',
    'sprints',
    'task_labels',
    'recurrences',
    'reminders'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'field_ts'
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_stamp_field_ts', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.stamp_unstamped_field_ts()',
      t || '_stamp_field_ts',
      t
    );
  END LOOP;
END
$stamp$;
