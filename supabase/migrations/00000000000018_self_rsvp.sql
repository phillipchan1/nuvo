-- Store the current user's RSVP status on each event row so the calendar
-- grid can dim unconfirmed invites without fetching the full raw payload.
alter table external_events add column if not exists self_rsvp text;

-- Backfill from existing events.
update external_events
set self_rsvp = (
  select elem->>'responseStatus'
  from jsonb_array_elements(coalesce(raw->'attendees', '[]'::jsonb)) as t(elem)
  where elem->>'self' = 'true'
  limit 1
)
where raw is not null;

-- Keep it in sync whenever raw is written (sync, rsvp, invite, etc.).
create or replace function sync_self_rsvp()
returns trigger language plpgsql as $$
begin
  new.self_rsvp := (
    select elem->>'responseStatus'
    from jsonb_array_elements(coalesce(new.raw->'attendees', '[]'::jsonb)) as t(elem)
    where elem->>'self' = 'true'
    limit 1
  );
  return new;
end;
$$;

create trigger trg_self_rsvp
before insert or update of raw on external_events
for each row execute function sync_self_rsvp();
