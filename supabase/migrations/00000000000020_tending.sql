-- Tending — the grooming ritual's snooze marker. `tended_at` records the last
-- time an item was consciously groomed or rested in a Tending session. It powers
-- the "recently tended → don't resurface" filter in the grooming queue, and
-- "let it rest" stamps it alongside flipping the item to `waiting` (Resting).
-- Everything else the ritual needs is computed; this is the one persisted bit.

alter table public.projects
  add column if not exists tended_at timestamptz;

alter table public.initiatives
  add column if not exists tended_at timestamptz;
