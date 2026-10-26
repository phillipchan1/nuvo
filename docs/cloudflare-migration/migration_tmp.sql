-- migration_tmp — source-only SECURITY DEFINER readers for the cutover.
--
-- This is NOT a supabase/migrations file. Do not `db push` it. PostgREST
-- would see it only if `migration_tmp` were added to the exposed schemas;
-- it must not be. Prod `db_schema` is `public,graphql_public` (verified
-- 2026-10-26), so these functions are not on PostgREST.
--
-- Already applied on Supabase prod (nuvo). Engineer 3 created it via the
-- Supabase management API SQL editor. Verified 2026-10-26 (PT) against
-- live `pg_get_functiondef` + grant catalog: owner postgres, SECURITY
-- DEFINER, search_path="", EXECUTE for migration_reader only.
--
-- Bodies below match that live `pg_get_functiondef` exactly
-- (`SET search_path TO ''`, pg_catalog-qualified jsonb_build_object /
-- jsonb_strip_nulls). Re-apply only if prod drifts.
--
-- After cutover is signed off and SOURCE_DATABASE_URL is deleted:
--   DROP SCHEMA migration_tmp CASCADE;
--
-- Verification (run as a privileged role; prints counts + ACLs, not rows):
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
--   WHERE n.nspname = 'migration_tmp';
--   SELECT 'auth_users' AS t, COUNT(*)::bigint AS n FROM migration_tmp.auth_users()
--   UNION ALL
--   SELECT 'auth_identities', COUNT(*) FROM migration_tmp.auth_identities();

BEGIN;

CREATE SCHEMA IF NOT EXISTS migration_tmp;

-- CREATE OR REPLACE cannot change a SETOF / TABLE shape. Drop first.
DROP FUNCTION IF EXISTS migration_tmp.auth_users();
DROP FUNCTION IF EXISTS migration_tmp.auth_identities();

CREATE OR REPLACE FUNCTION migration_tmp.auth_users()
 RETURNS TABLE(id uuid, raw_user_meta_data jsonb, email text, email_confirmed_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT u.id, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('name', u.raw_user_meta_data->>'name', 'full_name', u.raw_user_meta_data->>'full_name')), u.email::text, u.email_confirmed_at, u.created_at, u.updated_at FROM auth.users u $function$;

CREATE OR REPLACE FUNCTION migration_tmp.auth_identities()
 RETURNS TABLE(id uuid, user_id uuid, provider text, identity_data jsonb, provider_id text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
