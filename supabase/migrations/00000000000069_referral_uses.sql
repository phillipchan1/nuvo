-- Count when a friend first uses your code at Checkout (separate from paid credit).
alter table public.subscriptions
  add column if not exists referral_uses integer not null default 0,
  add column if not exists referral_last_use_at timestamptz;

comment on column public.subscriptions.referral_uses is
  'How many friends have used this operator''s code at Checkout. Incremented when referred_by is first written on the friend.';
comment on column public.subscriptions.referral_last_use_at is
  'When a friend most recently used this operator''s code at Checkout.';
