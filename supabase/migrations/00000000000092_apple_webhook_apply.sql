-- ---------------------------------------------------------------------------
-- App Store Server Notifications: claim the ledger and write the row in ONE
-- transaction.
--
-- `apple-webhook` used to INSERT the notificationUUID into
-- `apple_webhook_events`, then write `subscriptions`, then DELETE the claim if
-- the write threw. When the DELETE failed too, the claim stayed behind and
-- Apple's retry was acked as a duplicate — a renewal or refund lost for good.
-- supabase-js has no transactions, so the pair is one function: PostgREST runs
-- an RPC in a single transaction, and anything raised here rolls the claim
-- back with the write. Same contract as the Worker's `sql.begin` (#136).
--
-- The function DECIDES nothing. The patch is `planRowPatch` from
-- `_shared/planRules.ts` (the one rule both runtimes import), computed by the
-- edge function against the row it read. This only applies it, and only if
-- that row is still what the patch was computed against (status, plan_source,
-- lineage) — otherwise it raises, the claim rolls back, the function answers
-- 500 and Apple's retry recomputes from the fresh row. Optimistic, so the rail
-- precedence rule never needs a second, plpgsql definition.
--
-- Returns 'applied' | 'duplicate' | 'no_row'. A concurrent duplicate blocks on
-- the ledger's primary key until the first delivery commits, then sees the
-- claim and returns 'duplicate'; if the first rolled back, it proceeds.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the `apple-webhook`
-- function that calls it. The new function against a database without it
-- answers 500 on every write (Apple retries for ~3 days, so nothing is lost if
-- the migration follows promptly); the old function never calls it.
-- ---------------------------------------------------------------------------

create or replace function public.apple_webhook_apply(
  p_event_id                text,
  p_original_transaction_id text,
  p_expected_user_id        uuid,
  p_expected_status         text,
  p_expected_plan_source    text,
  p_patch                   jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.subscriptions%rowtype;
  v_keys text[];
begin
  if p_event_id is null or p_event_id = '' or p_original_transaction_id is null or p_original_transaction_id = '' then
    raise exception 'apple_webhook_apply: event id and lineage are required' using errcode = '22023';
  end if;

  select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as k;
  if exists (
    select 1 from unnest(v_keys) as k
    where k not in ('status', 'plan_source', 'current_period_end', 'cancel_at_period_end',
                    'apple_original_transaction_id', 'apple_product_id', 'apple_environment')
  ) then
    raise exception 'apple_webhook_apply: patch has a column it may not write' using errcode = '22023';
  end if;
  if p_patch ? 'apple_original_transaction_id'
     and p_patch->>'apple_original_transaction_id' is distinct from p_original_transaction_id then
    raise exception 'apple_webhook_apply: patch would move the lineage' using errcode = '22023';
  end if;

  insert into public.apple_webhook_events (event_id) values (p_event_id)
    on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if p_expected_user_id is null then
    -- Read found no row for the lineage. If one appeared since, recompute.
    if exists (select 1 from public.subscriptions where apple_original_transaction_id = p_original_transaction_id) then
      raise exception 'apple_webhook_apply: stale read' using errcode = '40001';
    end if;
    return 'no_row';
  end if;

  select * into v_row from public.subscriptions
    where user_id = p_expected_user_id
    for update;
  if not found
     or v_row.apple_original_transaction_id is distinct from p_original_transaction_id
     or v_row.status is distinct from p_expected_status
     or v_row.plan_source is distinct from p_expected_plan_source then
    raise exception 'apple_webhook_apply: stale read' using errcode = '40001';
  end if;

  if cardinality(v_keys) > 0 then
    update public.subscriptions set
      status               = case when p_patch ? 'status' then p_patch->>'status' else status end,
      plan_source          = case when p_patch ? 'plan_source' then p_patch->>'plan_source' else plan_source end,
      current_period_end   = case when p_patch ? 'current_period_end'
                                  then (p_patch->>'current_period_end')::timestamptz else current_period_end end,
      cancel_at_period_end = case when p_patch ? 'cancel_at_period_end'
                                  then coalesce((p_patch->>'cancel_at_period_end')::boolean, false) else cancel_at_period_end end,
      apple_product_id     = case when p_patch ? 'apple_product_id' then p_patch->>'apple_product_id' else apple_product_id end,
      apple_environment    = case when p_patch ? 'apple_environment' then p_patch->>'apple_environment' else apple_environment end
    where user_id = p_expected_user_id;
  end if;
  return 'applied';
end;
$$;

-- Functions are EXECUTE-able by PUBLIC by default. This one writes billing
-- state: the service role (the edge function) only.
revoke all on function public.apple_webhook_apply(text, text, uuid, text, text, jsonb) from public;
revoke all on function public.apple_webhook_apply(text, text, uuid, text, text, jsonb) from anon, authenticated;
grant execute on function public.apple_webhook_apply(text, text, uuid, text, text, jsonb) to service_role;

comment on function public.apple_webhook_apply(text, text, uuid, text, text, jsonb) is
  'apple-webhook: claim apple_webhook_events + apply a planRowPatch to the lineage''s row, atomically. Service role only.';
