-- Flows IV: big rocks — the week's named outcomes.
-- A small, varying set of named weekly OUTCOMES that sit above the task funnel:
-- a rock is an outcome (a title + what "the win" looks like), optionally in
-- service of a lead bet, and carried forward with a roll-count when it doesn't
-- move (a rock that won't die across weeks is a signal). It lives on the sprint
-- row as jsonb, right alongside goal + focus bets + day contexts.
--
-- Shape per element (see src/lib/types.ts BigRock):
--   { id, title, win, initiative_id, done_at, roll_count }
alter table public.sprints
  add column if not exists big_rocks jsonb not null default '[]'::jsonb;
