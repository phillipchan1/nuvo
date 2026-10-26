-- Copy-window unfreeze — restore recorded ACLs and pg_cron exactly.
--
-- Apply by hand if the copy is aborted (or after a rollback that returns
-- writes to Supabase). Do NOT run from CI, the Worker, or cutover-migrate.yml.
--
-- Restores:
--   1. INSERT/UPDATE/DELETE ACLs recorded by freeze.sql from
--      aclexplode(relacl), including PUBLIC. Only those rows are GRANTed
--      — no new direct grants to anon/authenticated that were only
--      inherited via PUBLIC. GRANT OPTION is restored when is_grantable.
--   2. cron.alter_job(jobid, active := was_active) for every recorded
--      nuvo-* job — a job that was already paused stays paused.
--
-- Idempotent: a second run (or a run when freeze.sql was never applied)
-- is a no-op NOTICE. Recording tables are dropped after a successful
-- restore so a later freeze can record a fresh snapshot.
--
-- Billing tables were never frozen. subscriptions / stripe_webhook_events /
-- apple_webhook_events / apple_notification_events are not in
-- freeze_grants and are not GRANTed or REVOKEd here.
--
-- Out of scope: partitioned tables, views, and column-level grants
-- (attacl). See freeze.sql.
--
-- Pair: docs/cloudflare-migration/freeze.sql. See docs/cloudflare-cutover.md.

DO $$
DECLARE
  rec record;
  grant_opt text;
  target text;
BEGIN
  IF to_regclass('migration_tmp.freeze_grants') IS NULL THEN
    RAISE NOTICE 'already unfrozen (migration_tmp.freeze_grants missing) — no-op';
    RETURN;
  END IF;
  FOR rec IN
    SELECT table_name, grantee, privilege, is_grantable
    FROM migration_tmp.freeze_grants
  LOOP
    grant_opt := CASE WHEN rec.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END;
    IF rec.grantee = 'PUBLIC' THEN
      target := 'PUBLIC';
      EXECUTE format(
        'GRANT %s ON TABLE public.%I TO PUBLIC%s',
        rec.privilege,
        rec.table_name,
        grant_opt
      );
    ELSE
      EXECUTE format(
        'GRANT %s ON TABLE public.%I TO %I%s',
        rec.privilege,
        rec.table_name,
        rec.grantee,
        grant_opt
      );
    END IF;
  END LOOP;
  DROP TABLE migration_tmp.freeze_grants;
END
$$;

DO $$
BEGIN
  IF to_regclass('migration_tmp.freeze_cron') IS NULL THEN
    RAISE NOTICE 'already unfrozen (migration_tmp.freeze_cron missing) — no-op';
    RETURN;
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'cron.job missing — no pg_cron jobs to restore';
    DROP TABLE IF EXISTS migration_tmp.freeze_cron;
    RETURN;
  END IF;
  PERFORM cron.alter_job(f.jobid, active := f.was_active)
  FROM migration_tmp.freeze_cron f;
  DROP TABLE migration_tmp.freeze_cron;
END
$$;
