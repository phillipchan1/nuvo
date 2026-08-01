-- Record comments — tag who wrote each line so human notes and future agent
-- comments can share one thread without guessing from user_id alone.

alter table public.record_comments
  add column if not exists author_kind text not null default 'user';

alter table public.record_comments
  drop constraint if exists record_comments_author_kind_check;

alter table public.record_comments
  add constraint record_comments_author_kind_check
  check (author_kind in ('user', 'agent'));
