import { toast } from "sonner";
import { convertTaskToEvent, createDefaults, pickCreateTarget, type CreateTarget } from "../lib/calendarWrite";
import type { Task } from "../lib/types";
import { useCalendarAccounts, useExternalEventMutations } from "./useCalendar";
import { useSettings } from "./useSettings";
import type { useTaskMutations } from "./useTasks";

/**
 * Task → Event, as one act, for both shells (D-177). It lived inline in
 * `Planner`, so the phone had no way to turn a block into a meeting.
 *
 * The calendar is the one the caller picked (D-152) or, unpicked, where every
 * create lands — the Settings default, never a hidden calendar (D-047). The
 * toast names it either way. Resolves whether the event was made.
 */
export function useTaskToEvent(mutations: ReturnType<typeof useTaskMutations>) {
  const { data: accounts = [] } = useCalendarAccounts();
  const { settings } = useSettings();
  const { createEvent } = useExternalEventMutations();

  return async (task: Task, picked?: CreateTarget): Promise<boolean> => {
    if (!task.start_time) return false;
    const durationMs = (task.duration_minutes ?? 30) * 60000;
    const end = new Date(new Date(task.start_time).getTime() + durationMs).toISOString();
    const target = pickCreateTarget(accounts, {
      ...createDefaults(settings),
      accountId: picked?.accountId,
      calendarId: picked?.calendarId,
    });
    if (!target) {
      toast.error("No visible calendar to create on. Unhide a calendar you own in Settings → Calendars.");
      return false;
    }
    const calendarName = accounts
      .find((a) => a.id === target.accountId)
      ?.calendars.find((c) => c.id === target.calendarId)?.summary;
    const start_at = task.start_time;
    const made = await convertTaskToEvent(
      () =>
        createEvent({
          title: task.title,
          start_at,
          end_at: end,
          accountId: target.accountId,
          calendarId: target.calendarId,
        }),
      {
        // Silent: ⌘Z still brings the task back, but a "Trashed" toast before
        // the event exists would announce the wrong half of the act.
        trash: () => mutations.trash(task, { undo: "silent" }),
        restore: () =>
          mutations.patchTask(task.id, { status: task.status, trashed_at: task.trashed_at }, { undo: false }),
      },
    );
    if (made) toast.success(calendarName ? `Event created on ${calendarName}` : "Event created");
    else toast.error("Couldn't create the event — is your calendar connected?");
    return made;
  };
}
