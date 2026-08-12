-- self_rsvp only ever matched Google's attendees[].self flag. Microsoft
-- Graph's attendee shape has no such flag — the calendar owner isn't marked,
-- so it must be found by matching attendees[].emailAddress.address against
-- the connected account's own email. Without this, M365 events never got a
-- self_rsvp, leaving RSVP dimming/buttons permanently hidden for them.
create or replace function sync_self_rsvp()
returns trigger language plpgsql as $$
declare
  owner_email text;
begin
  select email into owner_email from calendar_accounts where id = new.account_id;

  new.self_rsvp := coalesce(
    -- Google shape: the attendee row flagged self=true carries the status.
    (select elem->>'responseStatus'
     from jsonb_array_elements(coalesce(new.raw->'attendees', '[]'::jsonb)) as t(elem)
     where elem->>'self' = 'true'
     limit 1),
    -- Graph shape: no self flag — match by the account's own email instead.
    (select case elem->'status'->>'response'
              when 'accepted' then 'accepted'
              when 'declined' then 'declined'
              when 'tentativelyAccepted' then 'tentative'
              else 'needsAction'
            end
     from jsonb_array_elements(coalesce(new.raw->'attendees', '[]'::jsonb)) as t(elem)
     where owner_email is not null
       and lower(elem->'emailAddress'->>'address') = lower(owner_email)
     limit 1)
  );
  return new;
end;
$$;

-- Backfill existing M365 rows the old trigger definition never touched.
update external_events e
set self_rsvp = (
  select case elem->'status'->>'response'
           when 'accepted' then 'accepted'
           when 'declined' then 'declined'
           when 'tentativelyAccepted' then 'tentative'
           else 'needsAction'
         end
  from jsonb_array_elements(coalesce(e.raw->'attendees', '[]'::jsonb)) as t(elem)
  where lower(elem->'emailAddress'->>'address') = lower(
    (select email from calendar_accounts where id = e.account_id)
  )
  limit 1
)
where e.self_rsvp is null
  and e.raw ? 'bodyPreview';
