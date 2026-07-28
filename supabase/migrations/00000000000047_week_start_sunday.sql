-- Display week start: Sunday is the default for new accounts.
--
-- `week_start` is the "Week starts on" setting (Settings → Calendar) — the first
-- column of the week and month views. It is a DISPLAY preference only: the
-- planning week stays Monday-based in the kernel (sprints run Mon–Fri, and
-- planningRules.spansWeek deliberately tests weekdays only so a Sunday-start
-- grid can't leak a project into the neighbouring sprint week).
--
-- Only the column default moves. Existing rows keep whatever they hold, so
-- nobody's chosen order changes underneath them — a Monday reader stays Monday.
alter table public.user_settings alter column week_start set default 0;

comment on column public.user_settings.week_start is
  'First column of the week/month views: 0 = Sunday (default), 1 = Monday. Display only — the planning week is always Monday-based.';
