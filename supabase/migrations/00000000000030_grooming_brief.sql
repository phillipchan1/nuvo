-- Grooming lenses: the Brief document (docs/grooming-lenses.md §5).
--
-- One jsonb per project / initiative holding the What lens's adjudicated
-- sections — { scope, nonGoals, doneWhen, openQuestions, constraints }, each an
-- array of plain strings. The existing `outcome` (one-liner) and `target_date`
-- stay where they are; the Brief lens edits them alongside this document. The
-- Defined readiness axis reads outcome + brief.scope + brief.doneWhen +
-- target_date (src/lib/lenses.ts).
--
-- Additive and nullable — null simply means "no brief written yet".

alter table public.projects
  add column if not exists brief jsonb;

alter table public.initiatives
  add column if not exists brief jsonb;
