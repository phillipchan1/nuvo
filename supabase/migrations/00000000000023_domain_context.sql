-- Domain refinement — the routing context that makes passive grooming work.
-- `intention` is the human-facing VOW (the vow inscription, an ambition);
-- it's useless for placing a terse capture. `charter` is the user's plain-line
-- blurb of what the domain actually *is*, and `context` is Nuvo's AI-expanded
-- routing metadata (scope, entities/proper-nouns, keywords, boundary, exemplars)
-- — the machine signal grooming reads to route "reply to Obi" or "order Splenda"
-- to the right life area. A proposal cached on accept, like the soundness
-- verdict; `context_at` is when it was last expanded.
alter table public.domains
  add column if not exists charter text not null default '',
  add column if not exists context jsonb,
  add column if not exists context_at timestamptz;
