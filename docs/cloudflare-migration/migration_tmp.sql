-- migration_tmp — source-only SECURITY DEFINER readers for the cutover.
-- Same trust model as vault_tokens.sql: owner postgres, SECURITY DEFINER,
-- search_path = pg_catalog, pg_temp (pg_catalog first so pg_temp cannot
-- hijack types), EXECUTE for migration_reader only. Never GRANT USAGE
-- on schema auth to migration_reader. Never GRANT on auth to anyone.
--
-- This is NOT a supabase/migrations file. Do not `db push` it. PostgREST
-- would see it only if `migration_tmp` were added to the exposed schemas;
-- it must not be. Prod `db_schema` is `public,graphql_public` (verified
-- 2026-10-26), so these functions are not on PostgREST.
--
-- Engineer 3 created the wrappers via the Supabase management API SQL
-- editor. Verified 2026-10-26 (PT) against live `pg_get_functiondef` +
-- the grant catalog: owner postgres, SECURITY DEFINER, EXECUTE for
-- migration_reader only. Re-checked 2026-10-27 (PG 17.6, as postgres):
-- the functions already exist on prod, owned by postgres, search_path="".
-- postgres already has USAGE on auth and SELECT on every needed
-- auth.users / auth.identities column (hosted Supabase defaults).
--
-- Re-apply this file AND vault_tokens.sql as postgres before the next
-- dry run. Both use CREATE OR REPLACE so the search_path fix lands on
-- the existing functions. Do not GRANT on auth.
--
-- The Oct 26 dry runs (workflow_dispatch 40380281025 / 40380492458 at
-- SHA 3398470, before #99) failed because the job COPYed auth.users
-- directly as migration_reader (`permission denied for schema auth`).
-- #99 already moved those reads onto these functions. The grant block
-- that used to sit after COMMIT is gone — postgres can already read
-- what the DEFINER needs.
--
-- Bodies match live `pg_get_functiondef` except search_path, which is
-- `pg_catalog, pg_temp` (not empty — empty still searches pg_temp first
-- for types). pg_catalog-qualified jsonb_build_object / jsonb_strip_nulls.
--
-- Apply by hand (Phil / tech lead). Do NOT run from CI or
-- cutover-migrate.yml. Run as postgres (dashboard / management API).
--
-- The DO block below only stubs a NOLOGIN name if the role is missing,
-- so GRANT EXECUTE has a target. Prod SOURCE_DATABASE_URL is an
-- existing LOGIN migration_reader; this must not CREATE or ALTER that
-- login. IF NOT EXISTS leaves the LOGIN role untouched.
--
-- Record leftover migration_reader auth ACLs into
-- migration_tmp.auth_grants (first apply only) before the copy.
-- Prod (2026-10-27): migration_reader holds leftover SELECT, granted
-- by postgres, on all 16 auth tables (refresh_tokens, sessions,
-- one_time_tokens, mfa_factors, flow_state, …). auth.users alone has
-- 35 column grants. Harmless today only because migration_reader lacks
-- USAGE on auth. Nothing in this file GRANTs on auth. postgres's own
-- auth grants are pre-existing Supabase defaults — leave them.
--
-- After cutover is signed off and SOURCE_DATABASE_URL is deleted,
-- restore pre-state (revoke the leftovers, then drop):
--
--   BEGIN;
--   DO $cleanup$
--   DECLARE rec record;
--   BEGIN
--     -- Loop the recording. REVOKE ALL ON ALL TABLES IN SCHEMA auth can
--     -- 42501 on hosted postgres (not a superuser / not the table owner).
--     -- On PG17 a table-level REVOKE also clears that table's column ACLs.
--     FOR rec IN
--       SELECT * FROM migration_tmp.auth_grants
--       WHERE grantee = 'migration_reader'
--     LOOP
--       IF rec.objkind = 'schema' THEN
--         EXECUTE format(
--           'REVOKE %s ON SCHEMA %I FROM %I',
--           rec.privilege, rec.nspname, rec.grantee
--         );
--       ELSIF rec.objkind = 'table' THEN
--         EXECUTE format(
--           'REVOKE %s ON TABLE %I.%I FROM %I',
--           rec.privilege, rec.nspname, rec.objname, rec.grantee
--         );
--       ELSIF rec.objkind = 'column' THEN
--         EXECUTE format(
--           'REVOKE %s (%I) ON TABLE %I.%I FROM %I',
--           rec.privilege, rec.attname, rec.nspname, rec.objname, rec.grantee
--         );
--       END IF;
--     END LOOP;
--   END
--   $cleanup$;
--   DROP SCHEMA IF EXISTS migration_tmp CASCADE;
--   COMMIT;
--
-- Verification (privileged role; counts + ACLs, not rows). Do not SET ROLE
-- — SET ROLE to a NOLOGIN role fails on PG16+. Catalog + COUNT as current_user
-- (the DEFINER body still runs as postgres):
--   SELECT p.proname,
--          pg_get_userbyid(p.proowner) AS owner,
--          p.prosecdef,
--          p.proconfig,
--          pg_get_function_result(p.oid) AS result
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'migration_tmp'
--   ORDER BY 1;
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x,
--          has_function_privilege('migration_reader', p.oid, 'EXECUTE') AS reader_x
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'migration_tmp'
--   ORDER BY 1;
--   SELECT n.nspname,
--          has_schema_privilege('anon', n.oid, 'USAGE') AS anon_u,
--          has_schema_privilege('authenticated', n.oid, 'USAGE') AS auth_u,
--          has_schema_privilege('service_role', n.oid, 'USAGE') AS svc_u,
--          has_schema_privilege('migration_reader', n.oid, 'USAGE') AS reader_u
--   FROM pg_namespace n
--   WHERE n.nspname IN ('migration_tmp', 'auth');
--   -- reader_u on auth must be false.
--   SELECT 'auth_users' AS t, COUNT(*)::bigint AS n FROM migration_tmp.auth_users()
--   UNION ALL
--   SELECT 'auth_identities', COUNT(*) FROM migration_tmp.auth_identities();

BEGIN;

CREATE SCHEMA IF NOT EXISTS migration_tmp;

-- Stub only. Prod already has a LOGIN migration_reader (SOURCE_DATABASE_URL).
-- NOLOGIN here so a missing name can receive GRANT EXECUTE; IF NOT EXISTS
-- never replaces or alters the existing LOGIN role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_reader') THEN
    CREATE ROLE migration_reader NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS migration_tmp.auth_grants (
  nspname text NOT NULL,
  objkind text NOT NULL,
  objname text NOT NULL,
  attname text NOT NULL DEFAULT '',
  grantee text NOT NULL,
  privilege text NOT NULL,
  PRIMARY KEY (nspname, objkind, objname, attname, grantee, privilege)
);

COMMENT ON TABLE migration_tmp.auth_grants IS
  'Pre-copy leftover migration_reader auth ACLs. Cleanup revokes them; postgres defaults stay.';

-- First apply only — do not overwrite a prior recording.
-- aclexplode(NULL) yields 0 rows. Do not COALESCE to '{}'::aclitem[] —
-- that raises "ACL arrays must be one-dimensional" on a NULL acl, which
-- on prod is every auth column.
INSERT INTO migration_tmp.auth_grants (
  nspname, objkind, objname, attname, grantee, privilege
)
SELECT x.nspname, x.objkind, x.objname, x.attname, x.grantee, x.privilege
FROM (
  SELECT
    'auth'::text AS nspname,
    'schema'::text AS objkind,
    'auth'::text AS objname,
    ''::text AS attname,
    'migration_reader'::text AS grantee,
    e.privilege_type AS privilege
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(n.nspacl) e
  JOIN pg_roles r ON r.oid = e.grantee
  WHERE n.nspname = 'auth'
    AND r.rolname = 'migration_reader'

  UNION ALL

  SELECT
    n.nspname,
    'table',
    c.relname,
    '',
    'migration_reader',
    e.privilege_type
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) e
  JOIN pg_roles r ON r.oid = e.grantee
  WHERE n.nspname = 'auth'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND r.rolname = 'migration_reader'

  UNION ALL

  SELECT
    n.nspname,
    'column',
    c.relname,
    a.attname,
    'migration_reader',
    e.privilege_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(a.attacl) e
  JOIN pg_roles r ON r.oid = e.grantee
  WHERE n.nspname = 'auth'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND r.rolname = 'migration_reader'
) AS x
WHERE NOT EXISTS (SELECT 1 FROM migration_tmp.auth_grants);

-- CREATE OR REPLACE cannot change a SETOF / TABLE shape. Drop first.
DROP FUNCTION IF EXISTS migration_tmp.auth_users();
DROP FUNCTION IF EXISTS migration_tmp.auth_identities();

CREATE OR REPLACE FUNCTION migration_tmp.auth_users()
 RETURNS TABLE(id uuid, raw_user_meta_data jsonb, email text, email_confirmed_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$ SELECT u.id, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('name', u.raw_user_meta_data->>'name', 'full_name', u.raw_user_meta_data->>'full_name')), u.email::text, u.email_confirmed_at, u.created_at, u.updated_at FROM auth.users u $function$;

CREATE OR REPLACE FUNCTION migration_tmp.auth_identities()
 RETURNS TABLE(id uuid, user_id uuid, provider text, identity_data jsonb, provider_id text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$ SELECT i.id, i.user_id, i.provider::text, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('sub', i.identity_data->>'sub', 'provider_id', i.identity_data->>'provider_id')), i.provider_id::text, i.created_at, i.updated_at FROM auth.identities i $function$;

ALTER FUNCTION migration_tmp.auth_users() OWNER TO postgres;
ALTER FUNCTION migration_tmp.auth_identities() OWNER TO postgres;

REVOKE ALL ON SCHEMA migration_tmp FROM PUBLIC;
REVOKE ALL ON SCHEMA migration_tmp FROM anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION migration_tmp.auth_users() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION migration_tmp.auth_identities() FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA migration_tmp TO migration_reader;
GRANT EXECUTE ON FUNCTION migration_tmp.auth_users() TO migration_reader;
GRANT EXECUTE ON FUNCTION migration_tmp.auth_identities() TO migration_reader;

COMMIT;
