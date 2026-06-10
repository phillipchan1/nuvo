-- Nuvo core schema (Phase 1: the daily driver)
-- Single-user app: every table is row-level-secured to the owning user.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.task_status as enum ('inbox', 'planned', 'done', 'trashed');
create type public.task_priority as enum ('none', 'low', 'medium', 'high');
create type public.calendar_provider as enum ('google', 'm365');
create type public.sync_direction as enum ('two_way', 'read_only');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- domains / projects — schema only, zero UI in v1
-- ---------------------------------------------------------------------------
create table public.domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#6B7280',
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  domain_id uuid references public.domains (id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- labels
-- ---------------------------------------------------------------------------
create table public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#2563EB',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- tasks — the heart of the system.
-- A scheduled task IS a time block: do_date set + start_time null = planned;
-- both set = scheduled on the calendar. One row, no separate event entity.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  notes text not null default '',
  status public.task_status not null default 'inbox',
  do_date date,
  start_time timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  deadline date,
  priority public.task_priority not null default 'none',
  roll_count integer not null default 0,
  completed_at timestamptz,
  project_id uuid references public.projects (id) on delete set null,
  domain_id uuid references public.domains (id) on delete set null,
  google_event_id text,
  sort_order double precision not null default 0,
  -- a time block always has a day and a duration
  constraint blocked_tasks_have_do_date check (start_time is null or do_date is not null)
);

create index tasks_user_status_do_date_idx on public.tasks (user_id, status, do_date);
create index tasks_user_start_time_idx on public.tasks (user_id, start_time) where start_time is not null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.task_labels (
  task_id uuid not null references public.tasks (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (task_id, label_id)
);

-- ---------------------------------------------------------------------------
-- calendar_accounts — one row per connected provider account.
-- Refresh tokens live in Supabase Vault; only the secret id is stored here.
-- ---------------------------------------------------------------------------
create table public.calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.calendar_provider not null,
  email text not null,
  refresh_token_secret_id uuid,
  access_token text,
  access_token_expires_at timestamptz,
  sync_direction public.sync_direction not null,
  -- selected calendars: [{ id, summary, color, visible, sync_token }]
  calendars jsonb not null default '[]'::jsonb,
  -- Google push notification channel
  webhook_channel_id text,
  webhook_resource_id text,
  webhook_expires_at timestamptz,
  -- M365 delta link
  delta_link text,
  -- Google mirror calendar ("Nuvo") that scheduled tasks are written to
  mirror_calendar_id text,
  needs_reconnect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, email)
);

create trigger calendar_accounts_set_updated_at
  before update on public.calendar_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- external_events — read mirror of provider calendar events. Not tasks.
-- ---------------------------------------------------------------------------
create table public.external_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.calendar_accounts (id) on delete cascade,
  provider_event_id text not null,
  calendar_id text not null,
  title text not null default '(no title)',
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  busy boolean not null default true,
  raw jsonb,
  last_synced_at timestamptz not null default now(),
  unique (account_id, calendar_id, provider_event_id)
);

create index external_events_user_range_idx on public.external_events (user_id, start_at, end_at);

-- ---------------------------------------------------------------------------
-- sync_log — lightweight sync debugging
-- ---------------------------------------------------------------------------
create table public.sync_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  provider text not null,
  operation text not null,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index sync_log_created_at_idx on public.sync_log (created_at desc);

-- ---------------------------------------------------------------------------
-- user_settings — singleton row per user
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  day_start_hour integer not null default 6 check (day_start_hour between 0 and 23),
  day_end_hour integer not null default 23 check (day_end_hour between 1 and 24),
  week_start integer not null default 1, -- Monday
  hidden_calendar_ids jsonb not null default '[]'::jsonb,
  last_rollover_date date,
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: everything locked to the owning user.
-- ---------------------------------------------------------------------------
alter table public.domains enable row level security;
alter table public.projects enable row level security;
alter table public.labels enable row level security;
alter table public.tasks enable row level security;
alter table public.task_labels enable row level security;
alter table public.calendar_accounts enable row level security;
alter table public.external_events enable row level security;
alter table public.sync_log enable row level security;
alter table public.user_settings enable row level security;

create policy "own domains" on public.domains
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own labels" on public.labels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own task_labels" on public.task_labels
  for all using (exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()));
create policy "own calendar_accounts" on public.calendar_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own external_events" on public.external_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read own sync_log" on public.sync_log
  for select using (auth.uid() = user_id);
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Never expose provider tokens to the browser: the anon/authenticated roles
-- can see the account rows (for connection status UI) but not token columns.
revoke all on public.calendar_accounts from anon, authenticated;
grant select (id, user_id, provider, email, sync_direction, calendars,
              webhook_expires_at, mirror_calendar_id, needs_reconnect,
              created_at, updated_at) on public.calendar_accounts to authenticated;
grant update (calendars) on public.calendar_accounts to authenticated;
grant delete on public.calendar_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Vault wrappers (service_role only) — edge functions store/read refresh
-- tokens through these instead of touching the vault schema directly.
-- ---------------------------------------------------------------------------
create or replace function public.store_secret(p_name text, p_secret text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is not null then
    perform vault.update_secret(v_id, p_secret);
  else
    v_id := vault.create_secret(p_secret, p_name);
  end if;
  return v_id;
end;
$$;

create or replace function public.read_secret(p_id uuid)
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

revoke all on function public.store_secret(text, text) from public, anon, authenticated;
revoke all on function public.read_secret(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- New-user bootstrap: seed domains + settings row. (Single-user app, but the
-- seed must run after signup since rows are user-scoped.)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  insert into public.domains (user_id, name, color) values
    (new.id, 'Work',    '#2563EB'),
    (new.id, 'Church',  '#7C3AED'),
    (new.id, 'Trading', '#0D9488'),
    (new.id, 'Family',  '#DB2777');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Rollover: every incomplete task with do_date < today moves to today,
-- loses its time block (the slot has passed), keeps its duration, and
-- increments roll_count. Returns the rows that rolled so the caller (edge
-- function) can clean up Google mirror events.
-- ---------------------------------------------------------------------------
create or replace function public.rollover_tasks(p_today date)
returns setof public.tasks language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.tasks
     set do_date = p_today,
         start_time = null,
         roll_count = roll_count + 1,
         status = 'planned'
   where status in ('inbox', 'planned')
     and do_date is not null
     and do_date < p_today
  returning *;
end;
$$;

revoke all on function public.rollover_tasks(date) from public, anon, authenticated;
