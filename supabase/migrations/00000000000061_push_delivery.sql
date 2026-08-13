-- ---------------------------------------------------------------------------
-- Background reminders: subscriptions, and exactly-once delivery.
--
-- D-102 shipped reminders that only fire while the app is open. D-105 lifted the
-- restriction on the transport — push is allowed with explicit consent — so a
-- reminder can now reach a closed app. This is the storage that makes that safe.
--
-- ── The problem worth taking seriously ──────────────────────────────────────
--
-- One person, several places a reminder could come from: a Mac app that is open,
-- a phone that is asleep, a browser tab left running, and a server dispatcher
-- that doesn't know about any of them. Naively, "10 minutes before your standup"
-- arrives three times. Told three times is not three times as useful; it is the
-- notification theater Principle 9 refuses, arriving by accident rather than by
-- design.
--
-- ── The primitive: claim, then show ─────────────────────────────────────────
--
-- Every channel that wants to speak first CLAIMS the reminder. The claim is a
-- row, and a unique index makes it a race: exactly one claimant wins, everybody
-- else finds out instantly and stays quiet.
--
--   the unit is (user, reminder, fire instant) — NOT the device
--
-- which is the whole point. A person should be told once, not once per gadget.
-- The fire instant is in the key because a reminder whose lead is edited from 10
-- to 30 minutes is a different intention, and should be allowed to speak again.
--
-- Both sides can compute that key without talking to each other, because both
-- sides derive it from the same kernel (`_shared/reminderRules.ts`) — the same
-- reason the planning kernel exists.
--
-- The foreground client claims at the fire instant; the dispatcher only looks at
-- reminders already a little past due (`DISPATCH_LAG_MS`). So an open app
-- reliably wins and no push is sent at all — the correct outcome, since the user
-- is looking right at it.
-- ---------------------------------------------------------------------------

-- ── 1. Where a push can be delivered ────────────────────────────────────────
-- Deliberately NOT in the offline outbox (`SYNC_TABLES`). A subscription is not
-- user data that can be authored on a plane: it is minted by a live
-- `pushManager.subscribe()` against a registration that only exists on one
-- device, and a queued one would name an endpoint that was never created. Same
-- reasoning migration 55 gives for `calendar_accounts`.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The Web Push endpoint IS the identity: re-subscribing on the same device
  -- returns the same one, and a device that reinstalls gets a new one.
  endpoint text not null,
  -- The two keys the payload is encrypted to. Useless without the private VAPID
  -- key, which never leaves the edge function's secrets.
  p256dh text not null,
  auth text not null,

  -- Whose screen this is, for the Settings list ("iPhone · Safari"). Cosmetic.
  label text,
  -- The device's zone at subscribe time. Kept per-device because that is the
  -- honest granularity; `user_settings.time_zone` is what the dispatcher uses
  -- for deadline math, since a deadline belongs to a person, not a laptop.
  time_zone text,

  -- Bumped on every successful send; a subscription that 404/410s is deleted
  -- rather than retried forever (the endpoint is gone, not busy).
  last_seen_at timestamptz,
  failure_count integer not null default 0,

  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
create policy "own push_subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 2. The claim ────────────────────────────────────────────────────────────

create table if not exists public.reminder_deliveries (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- `<kind>:<stable id>:<anchor>` — built by `reminderKey()` in the kernel, so
  -- a claim made by the browser and one attempted by the dispatcher collide.
  reminder_key text not null,
  -- The resolved instant, truncated to the second. Both sides compute it from
  -- (anchor instant − lead); a changed lead is a new key and may speak again.
  fire_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  -- Diagnostics only: which channel got there first.
  channel text,
  primary key (user_id, reminder_key, fire_at)
);

-- The dispatcher asks "what is already claimed in this window", and the sweeper
-- deletes by age.
create index if not exists reminder_deliveries_fire_idx
  on public.reminder_deliveries (fire_at);

alter table public.reminder_deliveries enable row level security;
create policy "own reminder_deliveries" on public.reminder_deliveries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/**
 * Claim a reminder. True = you won and must show it; false = someone else did.
 *
 * `on conflict do nothing` + `found` is the whole mechanism: the insert is
 * atomic, so two devices racing at the same millisecond produce one winner
 * without a lock, a transaction the client has to hold, or a read-then-write
 * anyone could interleave. Getting this wrong is how you end up telling someone
 * about the same meeting twice.
 *
 * SECURITY INVOKER: the caller's own RLS decides whose reminders they may claim,
 * exactly as a direct insert would.
 */
create or replace function public.claim_reminder(
  p_key     text,
  p_fire_at timestamptz,
  p_channel text default null
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.reminder_deliveries (user_id, reminder_key, fire_at, channel)
  values (auth.uid(), p_key, date_trunc('second', p_fire_at), p_channel)
  on conflict (user_id, reminder_key, fire_at) do nothing;
  return found;
end;
$$;

grant execute on function public.claim_reminder(text, timestamptz, text) to authenticated;

/** Claims older than a day are answered questions. Keeps the table small enough
 *  that the dispatcher's window query stays an index scan forever. */
create or replace function public.prune_reminder_deliveries()
returns void language sql security definer set search_path = '' as $$
  delete from public.reminder_deliveries where fire_at < now() - interval '2 days';
$$;

revoke all on function public.prune_reminder_deliveries() from public, anon, authenticated;

-- ── 3. One timezone per person, for deadline math ───────────────────────────
-- A deadline speaks at 9am *somewhere*. The client has always known the device's
-- zone and the agent receives it per request, but a cron dispatcher has neither
-- — and `useHomeTimezone` is localStorage-only, so nothing durable existed. The
-- client keeps this fresh; the dispatcher reads it. Null falls back to UTC
-- rather than to one operator's own zone (Principle 16; see the `task-mirror`
-- hardcoding this replaced).

alter table public.user_settings add column if not exists time_zone text;

comment on column public.user_settings.time_zone is
  'IANA zone, kept fresh from the device. Used server-side to resolve a deadline date into an instant. Null = UTC — never a hardcoded home zone.';

-- ── 4. The heartbeat ────────────────────────────────────────────────────────
-- Every minute: the finest granularity the lead vocabulary needs (its smallest
-- step is 5 minutes), and cheap because the dispatcher opens with one indexed
-- read of who has reminders enabled at all.

select cron.schedule(
  'nuvo-push-dispatch',
  '* * * * *',
  $$select public.invoke_edge('push-dispatch')$$
);

select cron.schedule(
  'nuvo-reminder-deliveries-prune',
  '30 4 * * *',
  $$select public.prune_reminder_deliveries()$$
);
