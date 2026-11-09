-- ---------------------------------------------------------------------------
-- An App Store SANDBOX purchase is entitled only until its verified period end.
--
-- Tech Lead ruling (b), 2026-11-09 (docs/product/decisions.md, QA2 #136 flag 3).
-- Sandbox purchases (App Review, TestFlight, team builds) are accepted on prod
-- for any account (ruling (a): no allowlist) and tagged
-- `apple_environment = 'sandbox'`. Entitlement used to ignore the period end,
-- so a free sandbox purchase stayed a paid plan until an EXPIRED notification
-- reached the row — which, for sandbox, may be never.
--
-- So: a row with plan_source = 'apple' AND apple_environment = 'sandbox' is
-- entitled only while current_period_end > now(). For an Apple row that column
-- is written only from a verified transaction (apple-iap's confirm, the
-- JWS-verified webhook). NULL period end on such a row → not entitled.
-- Production rows and rows with no recorded environment are NOT held to the
-- period end — real payers must never be cut off by a renewal we didn't hear.
--
-- The SQL twin of `isEntitled` in supabase/functions/_shared/planRules.ts —
-- change both or neither (tests/plan-rules.test.ts holds them together).
-- Replaces the definition from 00000000000075_plan_source.sql. Written as a
-- CASE with explicit NULL handling: `NOT (plan_source = 'apple' AND
-- apple_environment = 'sandbox')` is NULL for an apple row with no recorded
-- environment, which would quietly lock out a real payer (see 0070's note).
-- `public.is_entitled(s)` calls this and needs no change.
-- No apply from here — this ships with the normal migration run.
-- ---------------------------------------------------------------------------

create or replace function public.entitled(s public.subscriptions)
returns boolean language sql stable as $$
  select case
    when s.status = 'active' then
      case
        when s.plan_source is not distinct from 'apple' and s.apple_environment is not distinct from 'sandbox'
          then coalesce(s.current_period_end > now(), false)
        else true
      end
    when s.status = 'trialing' then coalesce(s.trial_ends_at > now(), false)
    else false
  end;
$$;
