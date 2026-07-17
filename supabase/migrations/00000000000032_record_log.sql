-- Generalize the project log into a record log — the same "what's going on"
-- journal now serves initiatives too (parity with the project record). One row
-- hangs off exactly one parent: a project OR an initiative.

alter table public.project_comments rename to record_comments;

alter table public.record_comments
  add column if not exists initiative_id uuid references public.initiatives (id) on delete cascade;

alter table public.record_comments
  alter column project_id drop not null;

-- exactly one parent
alter table public.record_comments
  add constraint record_comments_one_parent
  check ((project_id is not null) <> (initiative_id is not null));

create index if not exists record_comments_initiative_idx
  on public.record_comments (initiative_id, created_at desc);
