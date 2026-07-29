-- ---------------------------------------------------------------------------
-- Contacts directory — real address books, synced.
--
-- Until now "contacts" meant *only* people who happened to appear in the
-- attendees array of a synced calendar event (00000000000016_contacts.sql).
-- That misses anyone you have emailed but never sat in a meeting with, which is
-- most of an address book. This table holds contacts pulled from a genuine
-- source — Google People (connections + "other contacts") and Apple CardDAV —
-- and the contacts() RPC below merges it with the event-derived list so the
-- guest picker searches one consolidated set.
--
-- account_id is NOT NULL: every directory contact is owned by the calendar
-- account it was pulled through, so disconnecting the account cascades its
-- contacts away and each sync can sweep only its own rows.
-- ---------------------------------------------------------------------------
create table public.contacts_directory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.calendar_accounts (id) on delete cascade,
  source text not null check (source in ('google', 'apple')),
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per address per account. The same person reachable from both a
  -- Google and an Apple account is two rows on purpose — contacts() collapses
  -- them at read time and reports both sources so the picker can say so.
  unique (account_id, email)
);

create index contacts_directory_user_email_idx
  on public.contacts_directory (user_id, email);

create trigger contacts_directory_set_updated_at
  before update on public.contacts_directory
  for each row execute function public.set_updated_at();

alter table public.contacts_directory enable row level security;

create policy "own contacts_directory" on public.contacts_directory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- contacts() — one ranked, deduplicated, source-attributed list.
--
-- Two fixes over 00000000000017_contacts_fuzzy.sql beyond the merge:
--
-- 1. Fuzzy matching no longer sees the domain. word_similarity() scores the
--    best-matching *substring* of the target, so "@gmail.com" alone scored ~0.5
--    against any gmail address — well over the old 0.15 floor. Every gmail
--    contact therefore matched every gmail address typed, and the ranking
--    (similarity x log(freq)) floated the most-met one to the top: typing a
--    stranger's address suggested your most frequent correspondent instead.
--    We now compare local part to local part and never trigram the domain.
--
-- 2. The old query grouped by (email, display_name), so one address spelled two
--    ways across events returned as two rows. Now it groups by address and
--    picks the most common real name.
-- ---------------------------------------------------------------------------
drop function if exists contacts(text);

create or replace function contacts(search text default '')
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
    where cd.user_id = auth.uid()
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
    where external_events.user_id = auth.uid()
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

grant execute on function contacts(text) to authenticated;
