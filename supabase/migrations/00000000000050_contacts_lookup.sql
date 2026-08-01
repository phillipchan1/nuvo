-- Contact lookup for the agent — the same ranked list the guest picker uses,
-- callable by a runtime that has no session.
--
-- `contacts(search)` (migration 48) is security definer over `auth.uid()`, so
-- it is exactly right for the browser and useless to the agent: the edge
-- function runs on the service role, `auth.uid()` is null there, and the query
-- returns an empty set. Rather than re-implement the ranking in Deno — which is
-- how the fuzzy-match bug in D-046 would come back, in a second place, unnoticed
-- — the body moves into `contacts_for(uid, search)` and `contacts(search)`
-- becomes a one-line wrapper over it. One definition of "who do I mean by Matt",
-- two callers.
--
-- The uid parameter is why the grants below matter: a security-definer function
-- that takes the user id as an argument would otherwise let any authenticated
-- caller read another account's address book. Only the service role may call it,
-- and only ever with the id of the user whose request is being served.

drop function if exists contacts(text);

create or replace function contacts_for(uid uuid, search text default '')
returns table(email text, display_name text, freq bigint, sources text[])
language sql stable security definer
set search_path = public
as $$
  with q as (
    select
      lower(trim(coalesce(search, ''))) as raw,
      -- The part before "@" is the only half worth fuzzy-matching. For a plain
      -- name search there is no "@" and split_part returns the whole string.
      split_part(lower(trim(coalesce(search, ''))), '@', 1) as local
  ),
  directory as (
    select lower(cd.email) as email, cd.display_name, cd.source, 0::bigint as freq
    from contacts_directory cd
    where cd.user_id = uid
  ),
  -- People seen on synced events. Kept as a source in its own right: someone
  -- you have met but never saved is still a real contact, and the meeting count
  -- is the only frequency signal we have for ranking.
  meeting_raw as (
    select
      lower(elem->>'email') as email,
      nullif(elem->>'displayName', '') as display_name
    from external_events
      cross join lateral jsonb_array_elements(raw->'attendees') as t(elem)
    where external_events.user_id = uid
      and (raw->'attendees') is not null
      and (elem->>'self') is distinct from 'true'
      and (elem->>'email') is not null
  ),
  meetings as (
    select
      email,
      mode() within group (order by display_name) as display_name,
      count(*) as freq
    from meeting_raw
    group by email
  ),
  all_rows as (
    select email, display_name, source, freq from directory
    union all
    select email, display_name, 'meeting'::text, freq from meetings
  ),
  merged as (
    select
      a.email,
      -- Prefer a real name from any source. nullif() discards the
      -- email-as-name placeholder so a source that knows the human name wins,
      -- and mode() ignores nulls outright.
      coalesce(
        mode() within group (order by nullif(lower(a.display_name), a.email)),
        a.email
      ) as display_name,
      max(a.freq) as freq,
      array_agg(distinct a.source order by a.source) as sources
    from all_rows a
    group by a.email
  )
  select m.email, m.display_name, m.freq, m.sources
  from merged m, q
  where
    q.raw = ''
    or m.email like '%' || q.raw || '%'
    or lower(m.display_name) like '%' || q.raw || '%'
    or word_similarity(q.local, split_part(m.email, '@', 1)) > 0.45
    or word_similarity(q.local, lower(m.display_name)) > 0.45
  order by
    case
      when q.raw = '' then log(m.freq::float + 2)
      else greatest(
        -- An exact address always outranks anything fuzzy.
        case when m.email = q.raw then 2.0 else 0.0 end,
        word_similarity(q.local, split_part(m.email, '@', 1)),
        word_similarity(q.local, lower(m.display_name))
      -- Meeting frequency nudges ties without letting a well-known contact
      -- outrank a better textual match.
      ) * log(m.freq::float + 2.5)
    end desc,
    m.freq desc,
    m.display_name
  limit 20
$$;

-- Never callable with someone else's id from the browser.
revoke execute on function contacts_for(uuid, text) from public;
revoke execute on function contacts_for(uuid, text) from anon;
revoke execute on function contacts_for(uuid, text) from authenticated;
grant execute on function contacts_for(uuid, text) to service_role;

create or replace function contacts(search text default '')
returns table(email text, display_name text, freq bigint, sources text[])
language sql stable security definer
set search_path = public
as $$
  select * from contacts_for(auth.uid(), search)
$$;

grant execute on function contacts(text) to authenticated;
