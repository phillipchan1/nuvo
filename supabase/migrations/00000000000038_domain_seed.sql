-- ---------------------------------------------------------------------------
-- SUPERSEDED by 00000000000042_domain_seed_after_billing.sql.
--
-- Migration 41 (billing) re-created handle_new_user() from the pre-38 body to
-- add the trial insert, which silently restored the domain seed this migration
-- removed. Kept (rather than deleted) because it may already have been applied;
-- 42 carries the merged intent. Harmless to run — 41 overwrites it, then 42
-- sets the final body.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- New-user bootstrap, revisited for multi-tenancy.
--
-- The original handle_new_user() seeded four domains on every signup —
-- Work / Church / Trading / Family. That is one operator's life handed to every
-- account as fact. Domains are the top of the funnel (initiatives, projects and
-- every calendar tint hang off them), so a stranger's first screen both
-- misdescribed their life and spent the one natural moment we get to teach what
-- a domain actually is.
--
-- Signup now seeds the settings row only. A brand-new account has **zero**
-- domains, and the client treats that as the signal to run the first-run domain
-- picker (choose from the domain kinds, name them yourself).
--
-- Existing accounts are untouched: this replaces the function, and never reads
-- or writes public.domains.
--
-- See docs/product/decisions.md — D-024 (multi-tenant), D-026 (this decision,
-- Q-06 resolved to option B) and docs/product/principles.md #16.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

-- The trigger itself (on_auth_user_created) is unchanged and still points here.
