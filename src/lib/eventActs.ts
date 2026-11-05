// What an act on an external calendar event MEANS, said once for both shells.
// The desktop reaches these through its right-click menu and the event popover;
// the phone through the event sheet's rows. Each used to be written inline in
// the desktop component that offered it — which is exactly why the phone had
// none of them (D-176): there was nothing to import.

import { toDateISO } from "./dates";
import type { ExternalEvent } from "./types";

/** Event → Task: the task that takes the event's place on the grid. The caller
 *  also hides the event (it stays on the server), so the hour holds one block. */
export function taskFromEvent(event: Pick<ExternalEvent, "title" | "start_at" | "end_at">) {
  const start = new Date(event.start_at);
  const duration = Math.round((new Date(event.end_at).getTime() - start.getTime()) / 60000);
  return {
    title: event.title,
    do_date: toDateISO(start),
    start_time: event.start_at,
    duration_minutes: duration > 0 ? duration : 30,
  };
}

/** Duplicate: a copy on the same calendar. Guests and recurrence deliberately do
 *  NOT carry — a copy that silently re-invited eight people would be the app
 *  mailing on the user's behalf, and a copied series is two series. */
export function duplicateEventInput(
  ev: Pick<ExternalEvent, "title" | "start_at" | "end_at" | "all_day" | "location" | "account_id" | "calendar_id">,
) {
  return {
    title: `${ev.title} (copy)`,
    start_at: ev.start_at,
    end_at: ev.end_at,
    all_day: ev.all_day,
    location: ev.location ?? undefined,
    accountId: ev.account_id,
    calendarId: ev.calendar_id,
    notifyGuests: false,
  };
}

/** Deleting an event you organize cancels it for every other guest — the
 *  confirmation has to say so rather than read like it only touches your own
 *  calendar. Unknown details (null) never claim guests. */
export function cancelNotifiesGuests(
  raw: { organizer?: { self?: boolean } | null; attendees?: { self?: boolean }[] | null } | null | undefined,
): number {
  if (raw?.organizer?.self !== true) return 0;
  return (raw.attendees ?? []).filter((a) => !a.self).length;
}
