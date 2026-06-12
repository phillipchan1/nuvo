-- Time Slots: a first-class timed container that holds many tasks.
-- A slot occupies the calendar grid like an event, but owns N tasks via
-- tasks.slot_id. Unlike a time-blocked task (one row = one block), a slot's
-- time/duration is independent of its tasks — the tasks inside lose their own
-- block (start_time null) and are ordered within the slot by sort_order.
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default '',
  do_date date not null,
  start_time timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  project_id uuid references public.projects (id) on delete set null,
  domain_id uuid references public.domains (id) on delete set null,
  color text,             -- explicit; else inherited from project/domain in UI
  google_event_id text    -- mirror busy-block id (null until slot-mirror runs)
);

create index slots_user_start_time_idx on public.slots (user_id, start_time);

create trigger slots_set_updated_at
  before update on public.slots
  for each row execute function public.set_updated_at();

-- A task can live inside a slot. Dropping/deleting the slot orphans its
-- children back to normal tasks (keeps do_date) — never deletes tasks.
alter table public.tasks
  add column slot_id uuid references public.slots (id) on delete set null;

create index tasks_slot_id_idx on public.tasks (slot_id) where slot_id is not null;

-- Row level security: locked to the owning user, like every other table.
alter table public.slots enable row level security;

create policy "own slots" on public.slots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
