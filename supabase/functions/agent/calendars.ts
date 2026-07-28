// Which calendar the agent is allowed to write to — one answer, two callers.
//
// This exists because of a real miss: asked to add "Call with Tiffany Souers",
// the agent put it on a **Women's** calendar the user had hidden months earlier.
// Two gaps made that legal. The context listed every writable calendar as an
// equal peer (the events feed filtered hidden ones; the write-target list did
// not), and the fallback was "first Google row wins" — arbitrary DB order, with
// the user's actual default setting never consulted. With a list of topical
// names in front of it and a person's name in the request, the model matched on
// subject matter.
//
// So the rule here is: **hidden means never offered, still nameable.** A hidden
// calendar is a stated intent — the user took it off their board — and nothing
// unprompted may land there. It stays resolvable by explicit name ("put it on
// Women's"), because naming it is the user deciding, which is the whole point.
// Everything unnamed goes to one default, and the default is the account the
// user marked in Settings, not whatever Postgres hands back first.

/** One writable calendar, plus the two facts that decide whether the agent may
 *  choose it on its own. */
export interface WritableCal {
  accountId: string;
  provider: "google" | "icloud";
  accountEmail: string;
  calendarId: string;
  name: string;
  /** Hidden from the board in Settings → Calendars. Nameable, never offered. */
  hidden: boolean;
  /** Primary calendar of the account the user set as default. At most one. */
  isDefault: boolean;
}

export interface RawCalendarAccount {
  id: string;
  provider: string;
  email: string;
  sync_direction: string;
  calendars: { id: string; summary: string }[] | null;
}

/** Google holiday / subscription feeds — readable but not writable. */
export function isReadOnlyCalendarId(id: string): boolean {
  return (
    id.includes("@import.calendar.google.com") ||
    id.includes("#holiday@") ||
    id.includes("@group.v.calendar.google.com")
  );
}

/** An account's own calendar — Google names the primary after the account
 *  email. Falls back to the first visible one, then the first one at all, so an
 *  iCloud account (which has no such convention) still resolves. */
export function accountPrimary(cals: WritableCal[], accountId: string): WritableCal | undefined {
  const mine = cals.filter((c) => c.accountId === accountId);
  const email = mine[0]?.accountEmail.trim().toLowerCase() ?? "";
  return (
    mine.find((c) => c.calendarId.toLowerCase() === email) ??
    mine.find((c) => !c.hidden) ??
    mine[0]
  );
}

/** Every calendar the agent could write to, flagged. Order is not meaningful —
 *  read `isDefault`, never index 0. */
export function buildWritableCalendars(
  accounts: RawCalendarAccount[],
  hiddenCalendarIds: string[],
  defaultAccountId: string | null,
): WritableCal[] {
  const hidden = new Set(hiddenCalendarIds);
  const out: WritableCal[] = [];

  for (const a of accounts) {
    if (a.sync_direction !== "two_way") continue;
    if (a.provider !== "google" && a.provider !== "icloud") continue;
    for (const c of a.calendars ?? []) {
      if (isReadOnlyCalendarId(c.id)) continue;
      out.push({
        accountId: a.id,
        provider: a.provider,
        accountEmail: a.email,
        calendarId: c.id,
        name: c.summary,
        hidden: hidden.has(c.id),
        isDefault: false,
      });
    }
  }

  // The default account's primary is the one calendar anything unnamed lands
  // on. Marked on the row rather than returned separately so every consumer —
  // the model reading context, the tool picking a fallback — sees the same fact.
  if (defaultAccountId) {
    const primary = accountPrimary(out, defaultAccountId);
    if (primary) primary.isDefault = true;
  }

  return out;
}

/** Where an unnamed event goes. Never a hidden calendar: if the user hid every
 *  writable calendar, the honest answer is "you tell me", not a silent guess. */
export function pickDefaultCalendar(cals: WritableCal[]): WritableCal | null {
  const offerable = cals.filter((c) => !c.hidden);
  return (
    cals.find((c) => c.isDefault && !c.hidden) ??
    offerable.find((c) => c.provider === "google") ??
    offerable[0] ??
    null
  );
}

/** What the model is shown as choosable. Hidden calendars are omitted on
 *  purpose — the model can't pick what it can't see, and a user who wants one
 *  can still name it. */
export function offerableCalendars(cals: WritableCal[]) {
  return cals
    .filter((c) => !c.hidden)
    .map((c) => ({
      accountId: c.accountId,
      provider: c.provider,
      accountEmail: c.accountEmail,
      calendarId: c.calendarId,
      name: c.name,
      ...(c.isDefault ? { isDefault: true as const } : {}),
    }));
}
