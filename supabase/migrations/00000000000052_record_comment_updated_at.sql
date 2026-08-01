-- Track comment edits so the thread can show "(edited)" like Notion.

alter table public.record_comments
  add column if not exists updated_at timestamptz;
