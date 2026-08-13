-- ---------------------------------------------------------------------------
-- Reminders — the app's first permission to speak first.
--
-- N-07 refused notifications and named its own escape clause: *time-critical
-- **now** signals only, opt-in*. Principle 9 reserves signal for `now`. The
-- rules that keep this inside those bounds live in
-- `supabase/functions/_shared/reminderRules.ts` (one kernel, both runtimes) —
-- this file is only the storage they need.
--
-- Two shapes, and the split matters:
--
--   user_settings.reminder_prefs   the DEFAULTS. Most reminders are never rows
--                                  at all — a meeting alert is derived from the
--                                  day you already have on screen. Low data
--                                  entry applied to a notification system.
--
--   reminders                      the OVERRIDES. A row exists only when the
--                                  user said something specific about one item:
--                                  a different lead, or `lead_minutes = null`
--                                  meaning "not this one". A table that would
--                                  otherwise hold thousands of derivable rows
--                                  holds tens.
--
-- `enabled` defaults FALSE. A fresh account is silent until it asks.
-- ---------------------------------------------------------------------------

alter table public.user_settings
  add column if not exists reminder_prefs jsonb not null default '{}'::jsonb;

comment on column public.user_settings.reminder_prefs is
  'Reminder defaults: {enabled, event_lead, block_lead, deadline_lead, deadline_time_minutes}. Shape + fill in _shared/reminderRules.ts (normalizeReminderPrefs). enabled defaults false — the app stays quiet until asked.';

create table if not exists public.reminders (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- What it hangs on.
  target_kind text not null check (target_kind in ('task', 'slot', 'event')),
  anchor text not null default 'start' check (anchor in ('start', 'deadline')),

  -- tasks.id / slots.id. Null for an external event, which is keyed instead —
  -- `external_events.id` is a mirror row id and a resync can renumber it, so a
  -- reminder pinned to it would silently detach (the same reason
  -- user_settings.hidden_events is keyed by account_id:provider_event_id).
  target_id uuid,
  event_key text,

  -- The whole vocabulary: minutes before the anchor. NULL = silenced, which is
  -- a deliberate "don't tell me about this one", not an absent preference.
  lead_minutes integer check (lead_minutes is null or lead_minutes >= 0),

  -- Denormalized resolved instant. Not authoritative (the kernel recomputes it
  -- from live anchors on every read) — it exists so a server-side dispatcher
  -- can find due rows without replaying the day.
  fire_at timestamptz,

  field_ts jsonb not null default '{}'::jsonb,

  -- Exactly one addressing mode, and it must match the kind.
  constraint reminders_one_target check (
    (target_kind = 'event' and event_key is not null and target_id is null)
    or (target_kind in ('task', 'slot') and target_id is not null and event_key is null)
  )
);

-- One reminder per (item, anchor). The upsert target for "set a reminder",
-- and what makes a repeated set idempotent rather than duplicative.
create unique index if not exists reminders_target_uniq
  on public.reminders (user_id, target_kind, anchor, coalesce(target_id::text, event_key));

create index if not exists reminders_user_fire_idx
  on public.reminders (user_id, fire_at);

create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;
create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── The outbox allowlist ----------------------------------------------------
-- A reminder set on a plane must land when the plane does, so `reminders` joins
-- the syncable set (client-minted ids, per-field LWW). It qualifies on the same
-- test N-15 applied to `recurrences`: writing one needs no server read.

create or replace function public.apply_patch(
  p_table    text,
  p_match    jsonb,
  p_patch    jsonb,
  p_field_ts jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed  text[] := array[
    'tasks','projects','initiatives','domains','key_results','slots',
    'labels','user_settings','record_comments','week_reviews','sprints',
    'task_labels','recurrences','reminders'
  ];
  v_stored   jsonb;
  v_key      text;
  v_mine     timestamptz;
  v_theirs   timestamptz;
  v_apply    jsonb := '{}'::jsonb;
  v_next_ts  jsonb;
  v_applied  text[] := array[]::text[];
  v_rejected text[] := array[]::text[];
  v_set      text;
  v_where    text;
  v_now      timestamptz := now();
begin
  if p_table is null or not (p_table = any (v_allowed)) then
    raise exception 'apply_patch: % is not a syncable table', p_table
      using errcode = '42501';
  end if;

  if p_match is null or jsonb_typeof(p_match) <> 'object' or p_match = '{}'::jsonb then
    raise exception 'apply_patch: a match is required' using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    return jsonb_build_object('applied', v_applied, 'rejected', v_rejected, 'matched', 0);
  end if;

  select string_agg(format('t.%I = %L', key, value), ' and ')
    into v_where
    from jsonb_each_text(p_match);

  execute format('select field_ts from public.%I t where %s', p_table, v_where)
     into v_stored;

  if v_stored is null then
    return jsonb_build_object('applied', v_applied, 'rejected', v_rejected, 'matched', 0);
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key in ('field_ts', 'id', 'user_id', 'created_at') then
      v_rejected := v_rejected || v_key;
      continue;
    end if;

    v_mine := least(
      coalesce((p_field_ts ->> v_key)::timestamptz, v_now),
      v_now
    );
    v_theirs := (v_stored ->> v_key)::timestamptz;

    if v_theirs is not null and v_mine <= v_theirs then
      v_rejected := v_rejected || v_key;
    else
      v_apply   := v_apply || jsonb_build_object(v_key, p_patch -> v_key);
      v_applied := v_applied || v_key;
    end if;
  end loop;

  if v_apply = '{}'::jsonb then
    return jsonb_build_object('applied', v_applied, 'rejected', v_rejected, 'matched', 1);
  end if;

  select coalesce(v_stored, '{}'::jsonb) || jsonb_object_agg(k, to_jsonb(v_mine_ts))
    into v_next_ts
    from (
      select k, least(coalesce((p_field_ts ->> k)::timestamptz, v_now), v_now) as v_mine_ts
        from unnest(v_applied) as k
    ) s;

  select string_agg(format('%I = s.%I', k, k), ', ')
    into v_set
    from unnest(v_applied) as k;

  execute format(
    'update public.%I t set %s, field_ts = $2 from (select * from jsonb_populate_record(null::public.%I, $1)) s where %s',
    p_table, v_set, p_table, v_where
  ) using v_apply, v_next_ts;

  return jsonb_build_object('applied', v_applied, 'rejected', v_rejected, 'matched', 1);
end;
$$;

grant execute on function public.apply_patch(text, jsonb, jsonb, jsonb) to authenticated;
