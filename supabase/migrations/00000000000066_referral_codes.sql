-- Personal friend-codes (referral), not affiliates.
-- One Stripe Coupon, many Promotion Codes. Attribution is written only by
-- stripe-webhook (service role). Operators read their own code; they never
-- write referred_by themselves.

alter table public.subscriptions
  add column if not exists referral_code text,
  add column if not exists stripe_promotion_code_id text,
  add column if not exists referred_by uuid references auth.users (id) on delete set null,
  add column if not exists referral_code_used text;

-- One personal code per account; the Stripe promo id is unique too.
create unique index if not exists subscriptions_referral_code_uidx
  on public.subscriptions (referral_code)
  where referral_code is not null;

create unique index if not exists subscriptions_stripe_promotion_code_id_uidx
  on public.subscriptions (stripe_promotion_code_id)
  where stripe_promotion_code_id is not null;

comment on column public.subscriptions.referral_code is
  'Operator''s personal share code (Stripe Promotion Code.code). Friend types it at Checkout.';
comment on column public.subscriptions.stripe_promotion_code_id is
  'Stripe Promotion Code id (promo_…) for this account''s referral_code.';
comment on column public.subscriptions.referred_by is
  'user_id of the operator whose code was used at this account''s first paid Checkout. Set by stripe-webhook only.';
comment on column public.subscriptions.referral_code_used is
  'The Promotion Code string applied at Checkout (audit / support).';
