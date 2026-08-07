-- ---------------------------------------------------------------------------
-- Bring `recurrences` into the offline outbox.
--
-- This was rejected once (N-15) and the rejection named its own escape clause:
-- materialisation needed a *server read* to work out which occurrences already
-- existed, so queuing it offline produced a series row with no occurrences
-- behind it — a recurring commitment that displays but does not exist.
--
-- The escape clause is now satisfied. The client already holds every task and
-- slot with its `recurrence_id` / `recurrence_date` (`["tasks","all"]`,
-- `["slots"]`), so "which dates are missing" is a pure computation over the
-- cache. With no read required, materialisation queues like anything else and a
-- standing 6–8am block can be set up on a plane.
--
-- Still NOT syncable, and why:
--
--   calendar_accounts      OAuth identity. Disconnecting must revoke tokens
--                          server-side; queuing it would show an account as
--                          gone while it kept syncing.
--   external_events        A mirror the sync job rewrites wholesale. Queued
--                          client writes would be clobbered by the next sweep.
--   event_domain_routing   Written by the AI router, not by hand.
--   activity_sources/
--   activity_bindings      Binds a live GitHub/calendar feed — only meaningful
--                          against a reachable API.
-- ---------------------------------------------------------------------------

alter table public.recurrences add column if not exists field_ts jsonb not null default '{}'::jsonb;

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
    'task_labels','recurrences'
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

  -- Alias-qualified: the UPDATE below joins `s`, and an unqualified `id` was
  -- ambiguous against it (migration 54).
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
