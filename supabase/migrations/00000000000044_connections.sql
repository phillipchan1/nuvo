-- ---------------------------------------------------------------------------
-- Connections — per-app bearer tokens that let other apps the user owns (or
-- voluntarily connects, e.g. "Lead Well") push tasks into this user's Nuvo
-- inbox over HTTP. The Todoist/Linear "API token" model, NOT full OAuth.
--
-- The raw token is shown to the user exactly once at creation and never stored:
-- we keep only sha256(token) (non-reversible — can't be used to forge auth) and
-- the last four chars for display. The public `capture` edge function looks a
-- connection up by token_hash and writes tasks scoped to its user_id.
-- ---------------------------------------------------------------------------
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null,                                  -- machine key, e.g. 'lead_well'
  name text not null,                                 -- user-facing label
  scopes text[] not null default '{inbox:write}',
  token_hash text not null unique,                    -- sha256(token), hex
  last_four text,                                     -- display only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index connections_user_idx on public.connections (user_id);
-- The capture hot path: look a live connection up by its token hash.
create index connections_token_hash_active_idx
  on public.connections (token_hash) where revoked_at is null;

create trigger connections_set_updated_at
  before update on public.connections
  for each row execute function public.set_updated_at();

alter table public.connections enable row level security;

-- Owner-only, mirroring "own tasks" in 00000000000001_core.sql. token_hash is a
-- non-reversible digest, so exposing it to its owner (who minted the token) can
-- neither leak the secret nor forge auth — no column-level revoke needed.
create policy "own connections" on public.connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Task provenance — nothing records where a task came from today. `source`
-- names the origin ('lead_well', 'email', 'manual'); `connection_id` links back
-- to the minting connection; `external_id` is the ingesting app's own id for the
-- item, which also powers idempotent re-delivery.
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists source text;
alter table public.tasks add column if not exists connection_id uuid references public.connections (id) on delete set null;
alter table public.tasks add column if not exists external_id text;

-- Idempotency: a given connection delivering the same external_id twice must
-- not create a duplicate task. Partial so manual/agent tasks (no external_id)
-- are unconstrained.
create unique index if not exists tasks_connection_external_id_idx
  on public.tasks (connection_id, external_id)
  where connection_id is not null and external_id is not null;
