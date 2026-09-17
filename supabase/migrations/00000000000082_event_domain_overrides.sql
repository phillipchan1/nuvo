-- A person's explicit correction for one event must outrank both the calendar
-- default and the AI router's cached verdict. Keep it in its own column so a
-- later route-events upsert cannot overwrite the human answer.

alter table public.event_domain_routing
  add column if not exists manual_domain_id uuid
  references public.domains (id) on delete cascade;
