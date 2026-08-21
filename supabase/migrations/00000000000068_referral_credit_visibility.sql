-- Referral credit visibility + robust awarding.
-- credits_earned: how many free months this operator has been granted (for Billing).
-- last_credit_at: when the most recent grant landed (toast / support).
-- replica identity full: realtime UPDATE payloads include old row so the client
-- can toast when credits_earned increases.

alter table public.subscriptions
  add column if not exists referral_credits_earned integer not null default 0,
  add column if not exists referral_last_credit_at timestamptz;

comment on column public.subscriptions.referral_credits_earned is
  'Count of free-month credits granted to this operator via friend-codes. Incremented by stripe-webhook only.';
comment on column public.subscriptions.referral_last_credit_at is
  'When the most recent referral free-month credit was granted.';

alter table public.subscriptions replica identity full;
