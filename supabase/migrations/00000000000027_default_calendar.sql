alter table public.user_settings
  add column if not exists default_calendar_account_id uuid references public.calendar_accounts(id) on delete set null;
