-- Copy-window freeze — revoke browser writes and pause nuvo-* pg_cron.
--
-- Apply by hand (Phil / tech lead) at the start of the copy window.
-- Do NOT run from CI, the Worker, or cutover-migrate.yml.
--
-- What this does:
--   1. Records current INSERT/UPDATE/DELETE grants on public app tables
--      for anon and authenticated into migration_tmp.freeze_grants
--      (first apply only — a second run must not overwrite the prior state
--      with the already-revoked grants).
--   2. REVOKE INSERT, UPDATE, DELETE on those tables from anon and
--      authenticated. SELECT stays so RPC reads (contacts) and GETs work.
--   3. Records cron.job.active for every nuvo-* job into
--      migration_tmp.freeze_cron, then cron.alter_job(..., active := false).
--
-- What this does NOT touch:
--   Billing stays on Supabase. subscriptions, stripe_webhook_events,
--   apple_webhook_events, and apple_notification_events keep their
--   current grants so Stripe / StoreKit / Apple webhooks (service_role)
--   and the entitlement read keep working. service_role is never revoked.
--
-- Pair: docs/cloudflare-migration/unfreeze.sql restores the recorded
-- grants and cron.active exactly. Order: freeze → snapshot → copy →
-- verify → switch or unfreeze. See docs/cloudflare-cutover.md.

CREATE SCHEMA IF NOT EXISTS migration_tmp;

CREATE TABLE IF NOT EXISTS migration_tmp.freeze_grants (
  table_name text NOT NULL,
  role_name text NOT NULL,
  privilege text NOT NULL,
  was_granted boolean NOT NULL,
  PRIMARY KEY (table_name, role_name, privilege)
);

CREATE TABLE IF NOT EXISTS migration_tmp.freeze_cron (
  jobid bigint PRIMARY KEY,
  jobname text NOT NULL,
  was_active boolean NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migration_tmp.freeze_grants) THEN
    INSERT INTO migration_tmp.freeze_grants (table_name, role_name, privilege, was_granted)
    SELECT
      c.relname,
      r.rolname,
      p.priv,
      has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), p.priv)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN (
        'subscriptions',
        'stripe_webhook_events',
        'apple_webhook_events',
        'apple_notification_events'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.objid = c.oid AND d.deptype = 'e'
      );
  END IF;
END
$$;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT table_name FROM migration_tmp.freeze_grants
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon, authenticated',
      rec.table_name
    );
  END LOOP;
END
$$;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'cron.job missing — no pg_cron jobs to pause';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM migration_tmp.freeze_cron) THEN
    INSERT INTO migration_tmp.freeze_cron (jobid, jobname, was_active)
    SELECT j.jobid, j.jobname, j.active
    FROM cron.job j
    WHERE j.jobname LIKE 'nuvo-%';
  END IF;
  PERFORM cron.alter_job(jobid, active := false)
  FROM migration_tmp.freeze_cron;
END
$$;

COMMENT ON TABLE migration_tmp.freeze_grants IS
  'Copy-window: prior INSERT/UPDATE/DELETE grants for anon/authenticated. Billing tables excluded.';
COMMENT ON TABLE migration_tmp.freeze_cron IS
  'Copy-window: prior cron.job.active for nuvo-* jobs. unfreeze.sql restores exactly.';
