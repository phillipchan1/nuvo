-- Heal tasks that live inside a PROJECT but are still resting in the inbox.
--
-- The inbox is for captures with no home. A task inside a project HAS a home, so
-- it belongs in that project's backlog — whether the project is slotted to this
-- week, another week, or no week at all is On Deck's business, not the inbox's.
--
-- Two "return to inbox" writers (useTasks.backToInbox, useVertical.toggleTaskInbox)
-- forced status='inbox' without checking, so project work got stranded in triage.
-- Worse, it was stranded in BOTH directions: backlogTasks() requires !inbox, so
-- these rows appeared ONLY in the inbox — invisible in their own project, while
-- nagging to be sorted.
--
-- Scope is deliberately project_id ONLY. A domain tag is a label, not a home: an
-- SCE-tagged capture with no project is still genuinely unsorted and stays put.
-- (Note: restingStatus() in src/lib/types.ts counts domain/initiative/sprint as
-- parented too — the older "parked on a domain = someday" model. That conflict is
-- unresolved, so this migration stays narrow rather than encoding either side.)
--
-- Non-destructive: corrects `status` only. No parentage, dates, or times change,
-- and nothing is deleted. Dateless by definition — a dated task isn't in the inbox.

update tasks
   set status = 'backlog'
 where status = 'inbox'
   and project_id is not null
   and do_date is null;
