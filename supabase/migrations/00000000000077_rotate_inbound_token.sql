-- The inbox address's local part is server-generated. A client must not pick
-- one (guessable, or a collision). Rotate is the one door: it sets a GUC the
-- guard trigger recognises, then writes a fresh 12-hex token. Direct UPDATEs
-- of inbound_token are reverted.

create or replace function public.guard_inbound_token()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' and NEW.inbound_token is distinct from OLD.inbound_token then
    if current_setting('nuvo.rotate_inbound', true) is distinct from 'on' then
      NEW.inbound_token := OLD.inbound_token;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists user_settings_guard_inbound_token on public.user_settings;
create trigger user_settings_guard_inbound_token
  before update on public.user_settings
  for each row execute function public.guard_inbound_token();

create or replace function public.rotate_inbound_token()
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_token := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  perform set_config('nuvo.rotate_inbound', 'on', true);
  update public.user_settings
     set inbound_token = v_token
   where user_id = auth.uid();
  if not found then
    raise exception 'no settings row';
  end if;
  return v_token;
end;
$$;

comment on function public.rotate_inbound_token() is
  'Replace this account''s inbox forwarding address. The previous local-part stops receiving.';

grant execute on function public.rotate_inbound_token() to authenticated;
