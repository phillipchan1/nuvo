-- Copy-window freeze — revoke browser writes and pause nuvo-* pg_cron.
--
-- Apply by hand (Phil / tech lead) at the start of the copy window.
-- Do NOT run from CI, the Worker, or cutover-migrate.yml.
--
-- What this does:
--   1. Records INSERT/UPDATE/DELETE ACLs from aclexplode(relacl) on public
--      app tables, including PUBLIC (grantee oid 0), into
--      migration_tmp.freeze_grants. First apply only — a second run must
--      not overwrite the prior state with the already-revoked grants.
--   2. REVOKE INSERT, UPDATE, DELETE on those tables from PUBLIC, anon
--      and authenticated. SELECT stays so RPC reads (contacts) and GETs
--      work. service_role is never revoked. No new direct grants are
--      created here.
--   3. Records cron.job.active for every nuvo-* job into
--      migration_tmp.freeze_cron, then cron.alter_job(..., active := false).
--
-- What this does NOT touch:
--   Billing stays on Supabase. subscriptions, stripe_webhook_events,
--   apple_webhook_events, and apple_notification_events keep their
--   current grants so Stripe / StoreKit / Apple webhooks (service_role)
--   and the entitlement read keep working.
--
-- Out of scope (Nuvo public app tables are ordinary relations):
--   partitioned tables (relkind = 'p' / relispartition), views
--   (relkind = 'v'), and column-level grants (attacl). This script
--   only records and revokes relation-level INSERT/UPDATE/DELETE on
--   relkind = 'r' tables that are not partitions.
--
-- Pair: docs/cloudflare-migration/unfreeze.sql restores the recorded
-- ACLs exactly (no new direct grants) and is idempotent. Order:
-- ship armed build → arm → freeze → snapshot → copy → verify →
-- switch + tail/reconcile, or unfreeze. See docs/cloudflare-cutover.md.

CREATE SCHEMA IF NOT EXISTS migration_tmp;

CREATE TABLE IF NOT EXISTS migration_tmp.freeze_grants (
  table_name text NOT NULL,
  grantee text NOT NULL,
  privilege text NOT NULL,
  is_grantable boolean NOT NULL,
  PRIMARY KEY (table_name, grantee, privilege)
);

CREATE TABLE IF NOT EXISTS migration_tmp.freeze_cron (
  jobid bigint PRIMARY KEY,
  jobname text NOT NULL,
  was_active boolean NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migration_tmp.freeze_grants) THEN
    INSERT INTO migration_tmp.freeze_grants (table_name, grantee, privilege, is_grantable)
    SELECT
      c.relname,
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END,
      acl.privilege_type,
      acl.is_grantable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    LEFT JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relispartition
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
      AND (acl.grantee = 0 OR r.rolname IS NOT NULL)
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
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relispartition
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
      )
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM PUBLIC, anon, authenticated',
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
  'Copy-window: aclexplode(relacl) INSERT/UPDATE/DELETE including PUBLIC. Billing tables excluded.';
COMMENT ON TABLE migration_tmp.freeze_cron IS
  'Copy-window: prior cron.job.active for nuvo-* jobs. unfreeze.sql restores exactly.';
