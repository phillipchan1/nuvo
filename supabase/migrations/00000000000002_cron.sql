-- Scheduled jobs. pg_cron + pg_net invoke edge functions over HTTP.
--
-- REQUIRED ONE-TIME SETUP (run once in the SQL editor after deploying):
--   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

-- Helper: invoke an edge function with the service role key from Vault.
create or replace function public.invoke_edge(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    raise warning 'invoke_edge: project_url / service_role_key not found in Vault; skipping %', p_function;
    return null;
  end if;
  return net.http_post(
    url := v_url || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := p_body,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.invoke_edge(text, jsonb) from public, anon, authenticated;

-- Midnight rollover at 00:05 America/Los_Angeles. pg_cron runs in UTC and LA
-- flips between UTC-7 and UTC-8, so run at both 07:05 and 08:05 UTC — the
-- rollover function is idempotent (it compares against the current LA date),
-- so the off-DST invocation is a no-op.
select cron.schedule('nuvo-rollover-pst', '5 8 * * *', $$select public.invoke_edge('rollover')$$);
select cron.schedule('nuvo-rollover-pdt', '5 7 * * *', $$select public.invoke_edge('rollover')$$);

-- M365 delta poll + Google polling fallback (no-op for accounts with a live
-- webhook channel), every 5 minutes.
select cron.schedule('nuvo-m365-poll', '*/5 * * * *', $$select public.invoke_edge('m365-sync')$$);
select cron.schedule('nuvo-google-poll', '*/5 * * * *', $$select public.invoke_edge('google-sync', '{"mode":"poll"}')$$);

-- Renew Google watch channels daily (channels expire; renew well ahead).
select cron.schedule('nuvo-google-renew', '15 9 * * *', $$select public.invoke_edge('google-sync', '{"mode":"renew-channels"}')$$);

-- Trim sync_log weekly, keep 30 days.
select cron.schedule('nuvo-trim-sync-log', '0 10 * * 0',
  $$delete from public.sync_log where created_at < now() - interval '30 days'$$);
