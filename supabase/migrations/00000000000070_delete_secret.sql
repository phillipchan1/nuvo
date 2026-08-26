-- Vault delete, matching store_secret / read_secret. Account wipe
-- (delete-account) has to drop refresh tokens and PATs, not just the rows
-- that point at them — vault.secrets does not cascade off auth.users.
create or replace function public.delete_secret(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = p_id;
end;
$$;

revoke all on function public.delete_secret(uuid) from public, anon, authenticated;
