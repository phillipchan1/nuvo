-- Two-sided referral: mark when the referrer was credited for this account's
-- first paid conversion so invoice.paid retries never double-pay.
alter table public.subscriptions
  add column if not exists referral_reward_granted_at timestamptz;

comment on column public.subscriptions.referral_reward_granted_at is
  'When the referred_by operator was credited one free month for this account''s first paid invoice. Null until then. Set only by stripe-webhook.';
