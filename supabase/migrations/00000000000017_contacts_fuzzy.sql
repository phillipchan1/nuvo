-- Upgrade contacts() to use pg_trgm fuzzy matching so partial / transposed
-- queries still surface results. Results are ranked by similarity × log(freq)
-- so frequent contacts float up even with imprecise queries.
create extension if not exists pg_trgm;

create or replace function contacts(search text default '')
returns table(email text, display_name text, freq bigint)
language sql stable security definer
set search_path = public
as $$
  with raw_contacts as (
    select
      lower(elem->>'email')                                                       as email,
      coalesce(nullif(elem->>'displayName', ''), lower(elem->>'email'))           as display_name
    from external_events
      cross join lateral jsonb_array_elements(raw->'attendees') as t(elem)
    where
      external_events.user_id = auth.uid()
      and (raw->'attendees') is not null
      and (elem->>'self') is distinct from 'true'
      and (elem->>'email') is not null
  ),
  grouped as (
    select email, display_name, count(*) as freq
    from raw_contacts
    group by 1, 2
  )
  select email, display_name, freq
  from grouped
  where
    search = ''
    or email        like '%' || lower(search) || '%'
    or display_name like '%' || lower(search) || '%'
    or word_similarity(lower(search), email)        > 0.15
    or word_similarity(lower(search), display_name) > 0.15
  order by
    case
      when search = '' then freq::float
      else greatest(
        word_similarity(lower(search), email),
        word_similarity(lower(search), display_name)
      ) * log(freq::float + 2)
    end desc
  limit 20
$$;
