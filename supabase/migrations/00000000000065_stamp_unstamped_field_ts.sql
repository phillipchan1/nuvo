-- Agent / MCP / Capture write rows through the service role without going
-- through `apply_patch`, so they used to change a column and leave `field_ts`
-- for that column untouched. The SPA's last-write-wins merge then treated the
-- write as if it had never happened: same stamp, local cache wins, and a
-- Grok Bot "Done, it's at 1:00" never appeared on the Schedule.
--
-- The SPA always writes value + stamp together. This trigger only stamps a
-- column when the VALUE changed and the STAMP did not — the forgotten-stamp
-- case. Client patches pass through unchanged.

create or replace function public.stamp_unstamped_field_ts()
returns trigger
language plpgsql
as $$
declare
  col text;
  old_ts jsonb := '{}'::jsonb;
  new_ts jsonb;
  skip constant text[] := array['field_ts', 'id', 'user_id', 'created_at', 'updated_at'];
  old_row jsonb;
  new_row jsonb := to_jsonb(NEW);
begin
  new_ts := coalesce(NEW.field_ts, '{}'::jsonb);

  if TG_OP = 'INSERT' then
    for col in select jsonb_object_keys(new_row)
    loop
      if col = any (skip) then continue; end if;
      if new_row -> col is null or new_row -> col = 'null'::jsonb then continue; end if;
      if new_ts ->> col is null then
        new_ts := new_ts || jsonb_build_object(col, now());
      end if;
    end loop;
    NEW.field_ts := new_ts;
    return NEW;
  end if;

  old_ts := coalesce(OLD.field_ts, '{}'::jsonb);
  old_row := to_jsonb(OLD);
  for col in select jsonb_object_keys(new_row)
  loop
    if col = any (skip) then continue; end if;
    if new_row -> col is not distinct from old_row -> col then continue; end if;
    if new_ts ->> col is not distinct from old_ts ->> col then
      new_ts := new_ts || jsonb_build_object(col, now());
    end if;
  end loop;
  NEW.field_ts := new_ts;
  return NEW;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks',
    'slots',
    'projects',
    'initiatives',
    'domains',
    'key_results',
    'labels',
    'user_settings',
    'record_comments',
    'week_reviews',
    'sprints',
    'task_labels',
    'recurrences',
    'reminders'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_stamp_field_ts',
      t
    );
    execute format(
      'create trigger %I before insert or update on public.%I
       for each row execute function public.stamp_unstamped_field_ts()',
      t || '_stamp_field_ts',
      t
    );
  end loop;
end;
$$;
