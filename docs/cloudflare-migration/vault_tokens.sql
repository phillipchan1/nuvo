-- migration_tmp.vault_tokens() — read Vault plaintext for the Neon copy job.
--
-- Apply by hand (Phil / tech lead). Do NOT run from CI, the Worker, or
-- cutover-migrate.yml. The copy job calls this function; it never creates it.
--
-- Same trust model as migration_tmp.auth_users():
--   owner postgres
--   SECURITY DEFINER
--   search_path = pg_catalog, pg_temp (pg_catalog first so pg_temp cannot hijack types)
--   EXECUTE for migration_reader only
--   revoked from PUBLIC, anon, authenticated, service_role
--   not in PostgREST db_schema
--
-- Prod already has this function. Re-apply (CREATE OR REPLACE) as postgres
-- before the next dry run so the search_path fix lands.
--
-- Returns the minimal columns the copy job needs. Joins only on the three
-- Vault id columns. Never grant this to a browser role.

CREATE SCHEMA IF NOT EXISTS migration_tmp;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_reader') THEN
    CREATE ROLE migration_reader NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA migration_tmp FROM PUBLIC;
REVOKE ALL ON SCHEMA migration_tmp FROM anon, authenticated, service_role;
GRANT USAGE ON SCHEMA migration_tmp TO migration_reader;

CREATE OR REPLACE FUNCTION migration_tmp.vault_tokens()
RETURNS TABLE (
  table_name text,
  row_id uuid,
  user_id uuid,
  secret text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    'calendar_accounts'::text AS table_name,
    c.id AS row_id,
    c.user_id,
    d.decrypted_secret AS secret
  FROM public.calendar_accounts AS c
  JOIN vault.decrypted_secrets AS d
    ON d.id = c.refresh_token_secret_id
  WHERE c.refresh_token_secret_id IS NOT NULL
    AND d.decrypted_secret IS NOT NULL

  UNION ALL

  SELECT
    'apple_identities'::text,
    a.user_id,
    a.user_id,
    d.decrypted_secret
  FROM public.apple_identities AS a
  JOIN vault.decrypted_secrets AS d
    ON d.id = a.refresh_token_secret_id
  WHERE a.refresh_token_secret_id IS NOT NULL
    AND d.decrypted_secret IS NOT NULL

  UNION ALL

  SELECT
    'activity_sources'::text,
    s.id,
    s.user_id,
    d.decrypted_secret
  FROM public.activity_sources AS s
  JOIN vault.decrypted_secrets AS d
    ON d.id = s.token_secret_id
  WHERE s.token_secret_id IS NOT NULL
    AND d.decrypted_secret IS NOT NULL
$$;

ALTER FUNCTION migration_tmp.vault_tokens() OWNER TO postgres;

REVOKE ALL ON FUNCTION migration_tmp.vault_tokens() FROM PUBLIC;
REVOKE ALL ON FUNCTION migration_tmp.vault_tokens() FROM anon;
REVOKE ALL ON FUNCTION migration_tmp.vault_tokens() FROM authenticated;
REVOKE ALL ON FUNCTION migration_tmp.vault_tokens() FROM service_role;

GRANT EXECUTE ON FUNCTION migration_tmp.vault_tokens() TO migration_reader;

COMMENT ON FUNCTION migration_tmp.vault_tokens() IS
  'Cutover-only: Vault plaintext for calendar_accounts, apple_identities, activity_sources. EXECUTE migration_reader only. Drop the schema after the rollback window.';
