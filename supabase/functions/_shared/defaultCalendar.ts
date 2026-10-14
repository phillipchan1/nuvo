// The default calendar — one rule for where an event lands when nobody names a
// calendar, read by the app's composers (`pickCreateTarget`, src/lib/calendarWrite)
// and by the agent (`buildWritableCalendars`, agent/calendars.ts), so a tap and
// a chat message put an unnamed event in the same place.
//
// The setting is a pair: `user_settings.default_calendar_account_id` (the
// account, since D-047) and `default_calendar_id` (which of its calendars, since
// D-152). A calendar id alone is not an address — the same shared calendar can
// sit under two connected accounts — so the calendar only counts inside the
// account it was chosen under.
//
// Zero imports, pure — imported by the browser (src/) and by edge functions.

/**
 * The default account's calendar to use: the one chosen in Settings if it is
 * still there and still on the board, otherwise the account's own calendar
 * (Google names the primary after the account email), otherwise its first.
 *
 * `calendarIds` is the default account's writable calendars in display order;
 * hidden ones are skipped for every rung (D-047 — a hidden calendar is never
 * chosen unnamed). Undefined when the account has nothing left to choose.
 */
export function accountDefaultCalendarId(
  calendarIds: string[],
  opts: {
    accountEmail: string;
    hiddenIds?: Iterable<string>;
    defaultCalendarId?: string | null;
  },
): string | undefined {
  const hidden = new Set(opts.hiddenIds ?? []);
  const visible = calendarIds.filter((id) => !hidden.has(id));
  const email = opts.accountEmail.trim().toLowerCase();
  return (
    (opts.defaultCalendarId && visible.includes(opts.defaultCalendarId)
      ? opts.defaultCalendarId
      : undefined) ??
    visible.find((id) => id.toLowerCase() === email) ??
    visible[0]
  );
}
