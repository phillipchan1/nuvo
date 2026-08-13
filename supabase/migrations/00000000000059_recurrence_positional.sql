-- ---------------------------------------------------------------------------
-- Recurrence: yearly, and "the last Friday of the month".
--
-- The engine has only ever known daily / weekly / monthly-by-date. Two whole
-- classes of real commitment were therefore UNREPRESENTABLE, not merely
-- awkward:
--
--   · anything annual — a birthday, a renewal, an anniversary review;
--   · anything positional — "the last Friday", "the 2nd Tuesday", which is the
--     shape most standing commitments actually take.
--
-- And it was lossy in the other direction too: an inbound Google series whose
-- RRULE carried BYSETPOS round-tripped through `fromGoogleRRULE` with the
-- position silently dropped, so an ALL-scope edit rewrote "the last Friday" as
-- "every Friday" and moved the user's meeting.
--
-- `bysetpos` and `bymonthday` are mutually exclusive by construction — a rule
-- holding both would have two answers to the same question. The picker clears
-- one when it sets the other, `expandRule` prefers `bysetpos`, and the check
-- below makes a row that tries to carry both impossible rather than merely
-- unlikely.
-- ---------------------------------------------------------------------------

alter table public.recurrences
  add column if not exists bysetpos integer,
  add column if not exists bymonth integer;

comment on column public.recurrences.bysetpos is
  'Which occurrence of `byweekday[0]` in the month: 1-4, or -1 for the last. Null = by date (bymonthday). RRULE BYSETPOS.';
comment on column public.recurrences.bymonth is
  'Yearly only: 1-12. Null = the anchor date''s own month. RRULE BYMONTH.';

alter table public.recurrences
  drop constraint if exists recurrences_freq_check;
alter table public.recurrences
  add constraint recurrences_freq_check
  check (freq in ('daily', 'weekly', 'monthly', 'yearly'));

alter table public.recurrences
  drop constraint if exists recurrences_bysetpos_range;
alter table public.recurrences
  add constraint recurrences_bysetpos_range
  check (bysetpos is null or bysetpos in (1, 2, 3, 4, -1));

alter table public.recurrences
  drop constraint if exists recurrences_bymonth_range;
alter table public.recurrences
  add constraint recurrences_bymonth_range
  check (bymonth is null or bymonth between 1 and 12);

-- One answer per rule: by date, or by position, never both.
alter table public.recurrences
  drop constraint if exists recurrences_one_day_rule;
alter table public.recurrences
  add constraint recurrences_one_day_rule
  check (bysetpos is null or bymonthday is null);
