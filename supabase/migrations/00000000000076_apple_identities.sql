-- Sign in with Apple — the two things Apple only tells you once.
--
-- 1. NAME AND EMAIL. Apple populates them on the *very first* authorization for
--    an Apple ID + app pair and never again; the only way back is the user
--    revoking Nuvo in Settings → Apple ID. So the first callback lands here.
--    The email may be a @privaterelay.appleid.com alias — anything that mails
--    the user has to tolerate that.
--
-- 2. THE REFRESH TOKEN. App Store guideline 5.1.1(v) requires in-app account
--    deletion, and for a Sign-in-with-Apple account that means calling Apple's
--    /auth/revoke — a rejection reason on its own. Revoking needs a token, and
--    the only chance to get one is exchanging the single-use (~5 min)
--    authorization code at sign-in. The token itself lives in vault.secrets,
--    like every other refresh token here; this table holds only its id.
--
-- Deliberately NOT columns on public.subscriptions. Identity is not billing,
-- and that table's apple_* columns are their own ongoing repair.
--
-- Not a pool (P10): it holds no work and nothing references it. It is one
-- fact per account about how that account signs in.

create table if not exists public.apple_identities (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  -- Apple's stable subject ("sub"). Survives an email change; unique per team.
  apple_user_id           text,
  email                   text,
  given_name              text,
  family_name             text,
  is_private_relay        boolean not null default false,
  -- vault.secrets id of Apple's refresh token. Null when the exchange was not
  -- configured yet — deletion then wipes the account and says it could not
  -- revoke, rather than refusing to delete.
  refresh_token_secret_id uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists apple_identities_apple_user_id_uidx
  on public.apple_identities (apple_user_id)
  where apple_user_id is not null;

alter table public.apple_identities enable row level security;

-- Read-only for the owner (Settings shows which methods are attached). Every
-- write is service-role: the apple-identity edge function, which is the only
-- thing that ever sees an authorization code.
create policy "read own apple_identity" on public.apple_identities
  for select using (auth.uid() = user_id);

comment on table public.apple_identities is
  'Sign in with Apple, per account. Holds what Apple says only once: the first '
  'authorization''s name/email, and the vault id of the refresh token that '
  'account deletion revokes via /auth/revoke.';
comment on column public.apple_identities.refresh_token_secret_id is
  'vault.secrets id of Apple''s refresh token. vault.secrets does not cascade '
  'off auth.users — delete-account drops it explicitly (see migration 70).';
comment on column public.apple_identities.is_private_relay is
  'True when email is a @privaterelay.appleid.com alias. Mail still works; the '
  'address is just not the user''s real one.';
