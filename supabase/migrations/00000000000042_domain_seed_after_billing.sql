-- ---------------------------------------------------------------------------
-- Re-apply D-026 on top of the billing trigger.
--
-- Migration 38 removed the four-domain seed from handle_new_user(). Migration
-- 41 (billing) then re-created the same function from the pre-38 body to add
-- the 14-day trial insert — which silently restored the seed. Last writer
-- wins, so 38 became a no-op the moment 41 landed.
--
-- This is the merged intent of both: settings row + trial (from 41), no domain
-- seed (from 38). A brand-new account has zero domains, which the client reads
-- as the signal to run the first-run domain picker.
--
-- Why no seed: Work / Church / Trading / Family is one operator's life handed
-- to every account as fact. Domains are the top of the funnel, so a stranger's
-- first screen both misdescribed their life and spent the only natural moment
-- we get to teach what a domain is. See docs/product/decisions.md D-026 and
-- docs/product/principles.md #16.
--
-- **Anything that re-creates handle_new_user() after this must keep the
-- no-seed body.** That is the second time this function has been clobbered by
-- a later migration re-declaring it from an older body.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  insert into public.subscriptions (user_id, status, trial_ends_at)
    values (new.id, 'trialing', now() + interval '14 days');
  return new;
end;
$$;

-- The trigger (on_auth_user_created) is unchanged and still points here.
