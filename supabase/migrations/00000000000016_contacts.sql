-- Contacts derived from synced event attendees.
-- No new OAuth scopes needed — reads attendees from raw JSONB already stored.
-- Returns unique contacts ranked by how often they appear across all synced events.
create or replace function contacts(search text default '')
returns table(email text, display_name text, freq bigint)
language sql stable security definer
set search_path = public
as $$
  select
    lower(elem->>'email') as email,
    coalesce(nullif(elem->>'displayName', ''), lower(elem->>'email')) as display_name,
    count(*) as freq
  from external_events
    cross join lateral jsonb_array_elements(raw->'attendees') as t(elem)
  where
    external_events.user_id = auth.uid()
    and (raw->'attendees') is not null
    and (elem->>'self') is distinct from 'true'
    and (elem->>'email') is not null
    and (
      search = ''
      or lower(elem->>'email') like '%' || lower(search) || '%'
      or lower(coalesce(elem->>'displayName', '')) like '%' || lower(search) || '%'
    )
  group by 1, 2
  order by freq desc
  limit 20
$$;

grant execute on function contacts(text) to authenticated;
