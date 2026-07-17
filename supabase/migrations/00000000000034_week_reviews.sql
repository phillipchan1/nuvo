-- Week Reviews — sealed weekly memory for the Review / Find.
-- Stores a durable snapshot so past weeks don't drift when live rows change,
-- plus Find response state, Keep, and Note to Monday.

create table if not exists public.week_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  -- Full WeekReport JSON (emblem, priorities, domains, capacity, highlights,
  -- brief, evidence, find) as sealed at write time.
  report jsonb not null default '{}'::jsonb,
  -- Optional AI-warmed narration for the featured Find (headline + detail).
  find_narration jsonb,
  -- User response to The Find: confirmed | corrected | dismissed | kept | null
  find_response text,
  find_kept boolean not null default false,
  -- Free-text letter from Friday-you to Monday-you.
  note_to_monday text,
  note_to_monday_seen_at timestamptz,
  sealed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create trigger week_reviews_updated_at before update on public.week_reviews
  for each row execute function public.set_updated_at();

create index if not exists week_reviews_user_week on public.week_reviews (user_id, week_start desc);

alter table public.week_reviews enable row level security;
create policy "own week_reviews" on public.week_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
