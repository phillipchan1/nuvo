-- Drop billing FKs to auth.users so a Neon-only Better Auth user can
-- receive a subscriptions row after the flip.
--
-- Hand-applied as postgres. Do NOT run from CI, merge, db push, the
-- Worker, or cutover-migrate.yml. Apply only after Phil's yes on #120,
-- as a pre-flip step — never earlier. See docs/cloudflare-cutover.md.
--
-- FKs dropped (the only billing-table FKs a Neon-only user would hit):
--   subscriptions.user_id     → auth.users(id)  ON DELETE CASCADE
--   subscriptions.referred_by → auth.users(id)  ON DELETE SET NULL
--
-- subscriptions.user_id stays PRIMARY KEY (subscriptions_pkey). That is
-- the index. Create one only if a user_id index is missing.
--
-- Rollback: drop-billing-auth-fk.rollback.sql (re-adds NOT VALID).

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_referred_by_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'subscriptions'
      AND indexdef ILIKE '%user_id%'
  ) THEN
    CREATE INDEX subscriptions_user_id_idx ON public.subscriptions (user_id);
  END IF;
END $$;
