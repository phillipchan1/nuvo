-- ---------------------------------------------------------------------------
-- Offline sync: per-field last-write-wins.
--
-- Nuvo's client can now queue writes for days (IndexedDB outbox) and replay
-- them whenever the network returns. That breaks the assumption every plain
-- `UPDATE` in this app was built on — that the writer had just read the row.
-- A patch replayed from a phone that has been in a tunnel since Tuesday would
-- otherwise flatten every field the laptop changed since, including fields the
-- phone never touched.
--
-- The fix is to make the unit of conflict the FIELD, not the row. Each syncable
-- table carries `field_ts`: a jsonb map of column name → the client wall-clock
-- of the write that last set it. `apply_patch` applies an incoming field only
-- when its stamp is strictly newer than the stored one.
--
-- Two devices editing different fields of one task therefore both keep their
-- work, and — because the decision depends only on the timestamps, never on
-- arrival order — a late-delivered stale write is rejected rather than winning
-- by being last. That is what makes out-of-order sync converge instead of
-- merely "not crashing".
--
-- Deletes stay terminal: a stale update that lands after a delete matches no
-- row and does nothing, so both orderings converge on "deleted" with no
-- tombstone table to keep.
--
-- Known limit: `field_ts` is client wall-clock, so a device with a badly wrong
-- clock can win or lose exchanges it shouldn't. `apply_patch` clamps stamps
-- from the future to `now()` so a fast clock cannot permanently pin a field,
-- but a slow clock still loses. A hybrid logical clock would close this; it is
-- deliberately out of scope here and recorded as a known risk.
-- ---------------------------------------------------------------------------

-- 1. The stamp map, on every table the outbox is allowed to write. -----------

alter table public.tasks            add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.projects         add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.initiatives      add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.domains          add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.key_results      add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.slots            add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.labels           add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.user_settings    add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.record_comments  add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.week_reviews     add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.sprints          add column if not exists field_ts jsonb not null default '{}'::jsonb;
alter table public.task_labels      add column if not exists field_ts jsonb not null default '{}'::jsonb;

-- 2. The merge. --------------------------------------------------------------

create or replace function public.apply_patch(
  p_table    text,
  p_match    jsonb,
  p_patch    jsonb,
  p_field_ts jsonb
) returns jsonb
language plpgsql
-- SECURITY INVOKER (the default) on purpose. This function writes arbitrary
-- tenant rows; running it as definer would hand every caller a way around RLS
-- in a multi-tenant database. As invoker, the caller's own policies still
-- decide what it may touch, exactly as a direct UPDATE would.
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Allowlisted because the table name reaches `format(%I)`. Anything not named
  -- here is refused outright rather than quoted and hoped for.
  v_allowed  text[] := array[
    'tasks','projects','initiatives','domains','key_results','slots',
    'labels','user_settings','record_comments','week_reviews','sprints','task_labels'
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

  -- The row's identity clause, built from the caller's match object. Values go
  -- through %L so they are literals, never fragments.
  select string_agg(format('%I = %L', key, value), ' and ')
    into v_where
    from jsonb_each_text(p_match);

  -- Read the current stamps under the caller's RLS. A row they cannot see is a
  -- row they cannot patch, and `v_stored` stays null → zero rows updated.
  execute format('select field_ts from public.%I where %s', p_table, v_where)
     into v_stored;

  if v_stored is null then
    -- Either no such row (deleted elsewhere — the delete wins, correctly) or
    -- RLS hid it. Both are a no-op, not an error: a queued patch for a row the
    -- user has since deleted must not park the whole outbox.
    return jsonb_build_object('applied', v_applied, 'rejected', v_rejected, 'matched', 0);
  end if;

  -- Decide field by field.
  for v_key in select jsonb_object_keys(p_patch) loop
    -- Never let a field stamp itself, and never let a client rewrite the map.
    if v_key in ('field_ts', 'id', 'user_id', 'created_at') then
      v_rejected := v_rejected || v_key;
      continue;
    end if;

    v_mine := least(
      coalesce((p_field_ts ->> v_key)::timestamptz, v_now),
      v_now  -- clamp a fast client clock; see the header note
    );
    v_theirs := (v_stored ->> v_key)::timestamptz;

    -- No stored stamp means the value predates this mechanism, so the stamped
    -- write is the better-informed one. Ties go to the stored value: it is
    -- already durable, and preferring it makes the outcome independent of which
    -- device happens to ask.
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

  -- Stamp only what we actually applied.
  select coalesce(v_stored, '{}'::jsonb) || jsonb_object_agg(k, to_jsonb(v_mine_ts))
    into v_next_ts
    from (
      select k, least(coalesce((p_field_ts ->> k)::timestamptz, v_now), v_now) as v_mine_ts
        from unnest(v_applied) as k
    ) s;

  -- `jsonb_populate_record` against the table's own row type does the casting,
  -- so a date column gets a date and a jsonb column gets jsonb — building a SET
  -- list out of %L text would corrupt every non-text column.
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

comment on function public.apply_patch(text, jsonb, jsonb, jsonb) is
  'Per-field last-write-wins patch for the offline outbox. Applies a field only when its client stamp beats the stored one, so replayed offline edits merge instead of clobbering.';

grant execute on function public.apply_patch(text, jsonb, jsonb, jsonb) to authenticated;
