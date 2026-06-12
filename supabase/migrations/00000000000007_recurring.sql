-- Derive recurring_event_id from the raw Google event payload.
-- For recurring event instances, Google sets e.recurringEventId to the
-- master series event ID. We expose it as a stored generated column so the
-- client can tell whether an event is part of a series without fetching raw.
alter table public.external_events
  add column if not exists recurring_event_id text
    generated always as (raw->>'recurringEventId') stored;
