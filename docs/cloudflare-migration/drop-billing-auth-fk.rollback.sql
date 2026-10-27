-- Re-add billing FKs to auth.users as NOT VALID.
-- Hand-applied as postgres. Does not scan existing Neon-only rows.
-- VALIDATE CONSTRAINT later only if every user_id / referred_by is
-- back in auth.users.

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_referred_by_fkey
  FOREIGN KEY (referred_by) REFERENCES auth.users (id) ON DELETE SET NULL
  NOT VALID;
