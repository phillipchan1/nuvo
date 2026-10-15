-- Live changes ride private per-account broadcast topics, not postgres_changes.
--
-- The SPA listened with one unfiltered `postgres_changes` channel per table.
-- Realtime RLS-checks INSERT and UPDATE per subscriber, but it cannot check a
-- DELETE (the row is gone), so it sends every DELETE to every subscriber of
-- the table: each signed-in client received the primary key of every row any
-- account deleted. For `user_settings`, `subscriptions` and
-- `event_domain_routing` the primary key IS the other account's auth user id.
-- Confirmed on the local stack 2026-10-15 (ghost@ received dummy@'s deletes).
--
-- A `user_id=eq.<uid>` filter is not a fix. With DEFAULT identity a filtered
-- DELETE is dropped for its owner too, so live deletes stop. With FULL identity
-- it reaches only the owner, but that costs a full old row in the WAL for every
-- UPDATE and DELETE on 13 tables, `task_labels` has no `user_id` to filter on,
-- and the server still serves the unfiltered stream to any client that asks:
-- every build already installed, or anyone holding a JWT.
--
-- So the server routes instead. `rt_broadcast()` sends each committed row
-- change to `nuvo:<owner uid>:<table>` as a private broadcast, and the policy
-- below lets an account join only its own topics. The row's owner is the same
-- rule the table's RLS already uses (`auth.uid() = user_id`; for `task_labels`,
-- the task's owner).
--
-- Payload, read by `useRealtime` → `applyLiveChange` as a LiveChange:
--   { table, eventType, new, old }
--   new: the row for INSERT/UPDATE, null for DELETE
--   old: the row for DELETE; for UPDATE only where the trigger asks for it
--        ('with_old': `subscriptions`, whose referral toasts compare old/new)
--
-- This migration only ADDS the broadcast. Taking the tables out of
-- `supabase_realtime` is migration 91, and only that closes the leak. Keep the
-- two apart in production so installed clients still on postgres_changes keep
-- their live updates until they have updated.

create or replace function public.rt_broadcast()
returns trigger
language plpgsql
-- Definer, because `realtime.send` swallows its own errors: run as the writing
-- user (who has no INSERT on realtime.messages), every message would be
-- dropped with only a WARNING in the log.
security definer
set search_path = ''
as $$
declare
  row_ jsonb := to_jsonb(coalesce(new, old));
  owner_ uuid;
begin
  if tg_table_name = 'task_labels' then
    -- No user_id of its own; its RLS is the task's owner. A label row that
    -- cascades out with its task finds no task and is skipped: the task's own
    -- DELETE already evicts the row, labels and all.
    select t.user_id into owner_ from public.tasks t where t.id = (row_->>'task_id')::uuid;
  else
    owner_ := (row_->>'user_id')::uuid;
  end if;
  if owner_ is null then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'table', tg_table_name,
      'eventType', tg_op,
      'new', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      'old', case
        when tg_op = 'DELETE' then to_jsonb(old)
        when tg_op = 'UPDATE' and tg_nargs > 0 and tg_argv[0] = 'with_old' then to_jsonb(old)
      end
    ),
    tg_op,
    'nuvo:' || owner_::text || ':' || tg_table_name,
    true
  );
  return null;
end $$;

revoke all on function public.rt_broadcast() from public, anon, authenticated;

-- One trigger per live table: the 16 in useRealtime's TABLE_TO_KEYS, plus
-- `subscriptions` (useSubscriptionLiveSync).
drop trigger if exists rt_broadcast on public.tasks;
create trigger rt_broadcast after insert or update or delete on public.tasks for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.task_labels;
create trigger rt_broadcast after insert or update or delete on public.task_labels for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.slots;
create trigger rt_broadcast after insert or update or delete on public.slots for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.recurrences;
create trigger rt_broadcast after insert or update or delete on public.recurrences for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.labels;
create trigger rt_broadcast after insert or update or delete on public.labels for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.external_events;
create trigger rt_broadcast after insert or update or delete on public.external_events for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.calendar_accounts;
create trigger rt_broadcast after insert or update or delete on public.calendar_accounts for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.user_settings;
create trigger rt_broadcast after insert or update or delete on public.user_settings for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.domains;
create trigger rt_broadcast after insert or update or delete on public.domains for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.initiatives;
create trigger rt_broadcast after insert or update or delete on public.initiatives for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.projects;
create trigger rt_broadcast after insert or update or delete on public.projects for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.record_comments;
create trigger rt_broadcast after insert or update or delete on public.record_comments for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.key_results;
create trigger rt_broadcast after insert or update or delete on public.key_results for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.sprints;
create trigger rt_broadcast after insert or update or delete on public.sprints for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.week_reviews;
create trigger rt_broadcast after insert or update or delete on public.week_reviews for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.event_domain_routing;
create trigger rt_broadcast after insert or update or delete on public.event_domain_routing for each row execute function public.rt_broadcast();
drop trigger if exists rt_broadcast on public.subscriptions;
create trigger rt_broadcast after insert or update or delete on public.subscriptions for each row execute function public.rt_broadcast('with_old');

-- Join only your own topics. There is no INSERT policy: no client can send on
-- a `nuvo:` topic, its own included. Only the trigger speaks there.
drop policy if exists "nuvo live: read own topics" on realtime.messages;
create policy "nuvo live: read own topics" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and split_part((select realtime.topic()), ':', 1) = 'nuvo'
    and split_part((select realtime.topic()), ':', 2) = (select auth.uid())::text
  );
