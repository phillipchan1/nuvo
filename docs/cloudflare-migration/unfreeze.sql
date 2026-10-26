-- Copy-window unfreeze — restore recorded grants and pg_cron exactly.
--
-- Apply by hand if the copy is aborted (or after a rollback that returns
-- writes to Supabase). Do NOT run from CI, the Worker, or cutover-migrate.yml.
--
-- Restores:
--   1. INSERT/UPDATE/DELETE on public app tables for anon / authenticated
--      to the exact was_granted recorded by freeze.sql. Privileges that
--      were already false stay revoked.
--   2. cron.alter_job(jobid, active := was_active) for every recorded
--      nuvo-* job — a job that was already paused stays paused.
--
-- Billing tables were never frozen. subscriptions / stripe_webhook_events /
-- apple_webhook_events / apple_notification_events are not in
-- freeze_grants and are not GRANTed or REVOKEd here.
--
-- Pair: docs/cloudflare-migration/freeze.sql. See docs/cloudflare-cutover.md.

DO $$
DECLARE
  rec record;
BEGIN
  IF to_regclass('migration_tmp.freeze_grants') IS NULL THEN
    RAISE EXCEPTION 'migration_tmp.freeze_grants missing — freeze.sql was not applied';
  END IF;
  FOR rec IN
    SELECT table_name, role_name, privilege
    FROM migration_tmp.freeze_grants
    WHERE was_granted
  LOOP
    EXECUTE format(
      'GRANT %s ON TABLE public.%I TO %I',
      rec.privilege,
      rec.table_name,
      rec.role_name
    );
  END LOOP;
END
$$;

DO $$
BEGIN
  IF to_regclass('migration_tmp.freeze_cron') IS NULL THEN
    RAISE EXCEPTION 'migration_tmp.freeze_cron missing — freeze.sql was not applied';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'cron.job missing — no pg_cron jobs to restore';
    RETURN;
  END IF;
  PERFORM cron.alter_job(f.jobid, active := f.was_active)
  FROM migration_tmp.freeze_cron f;
END
$$;

DROP TABLE IF EXISTS migration_tmp.freeze_grants;
DROP TABLE IF EXISTS migration_tmp.freeze_cron;
