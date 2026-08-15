/**
 * Mirroring — pushing Nuvo's own time blocks onto the calendar the user's phone
 * already shows them, so a block made here exists on the lock screen.
 *
 * ## Why this file exists
 *
 * The mirror was Google-only, and gated on `calendar_accounts.mirror_calendar_id`,
 * which exactly one line in `google-oauth/index.ts` ever set. The 2026-08-12
 * audit ranked that #3: an iCloud-only user's blocks never left the app, and
 * since iCloud *is* a writable provider (`src/lib/calendarWrite.ts`), that was
 * an asymmetry rather than a policy.
 *
 * Adding a second provider means the *decisions* — what gets a mirror event,
 * what it's called, which resource it lives at — now have two callers each. So
 * they live here, pure and importable, exactly like the planning kernel: the
 * two providers must agree about what a mirrored block is, or a user with both
 * accounts connected gets two subtly different copies of their Tuesday.
 *
 * **Zero imports, zero Deno globals.** `npm test` reaches this file; it cannot
 * reach a CalDAV round trip. So every rule that can be decided without a
 * network lives here, and the provider functions stay thin transport.
 */

/** The dedicated calendar Nuvo writes its blocks to, on every provider.
 *  Dedicated rather than the user's main calendar so the mirror can be hidden,
 *  unsubscribed or deleted in one move — and so nothing Nuvo writes can be
 *  confused with something the user booked. */
export const MIRROR_CALENDAR_NAME = "Nuvo";

/** Marks every resource Nuvo writes. Load-bearing beyond tidiness: the sync
 *  loops skip any inbound event whose UID starts with this, which is the
 *  backstop that stops Nuvo re-importing its own mirrored blocks as external
 *  events — the failure that would double-count every task against the day AND
 *  the domain time ledger (D-085). */
export const MIRROR_UID_PREFIX = "nuvo-mirror-";

/** What the mirror calendar says about itself, in the provider's own UI. */
export const MIRROR_CALENDAR_DESCRIPTION =
  "Time blocks written by Nuvo. This calendar is one-directional: Nuvo replaces what it wrote here on every sync, so edits made in this app won't stick. Move the block in Nuvo instead.";

/**
 * The line every mirrored block carries in its description.
 *
 * Mirroring is deliberately one-directional — the app's version wins — which
 * means dragging a Nuvo block inside Google or Apple Calendar is reverted on
 * the next reconcile. That is the model (see D-107 / Q-13), and the decision
 * that goes with it is that it must never be **silent**: this is the only place
 * in Nuvo that actively discards something the user did.
 *
 * The warning has to live *here*, on the event, because that is the only
 * channel that reaches the person at the moment they would make the mistake.
 * They are not in Nuvo when they drag the block — they are in Apple Calendar on
 * a phone, where no amount of Nuvo UI can reach them.
 */
export const MIRROR_NOTE =
  "— Written by Nuvo. Moving or editing this here won't stick: Nuvo replaces it on the next sync. Change the block in Nuvo instead.";

/** A mirrored block's description: the user's own notes, then the warning.
 *  Notes first — the note is what they came to read; the warning is the label
 *  on the tin. */
export function mirrorDescription(notes?: string | null): string {
  const body = (notes ?? "").trim();
  return body ? `${body}\n\n${MIRROR_NOTE}` : MIRROR_NOTE;
}

export type MirrorKind = "task" | "slot";

/**
 * The mirror resource's identity, derived from the row it mirrors.
 *
 * Deterministic on purpose, and it is the reason the iCloud path needs no new
 * column. Google hands back an opaque event id that has to be stored
 * (`tasks.google_event_id`), so a lost id orphans the event. A CalDAV resource
 * URL is something the *client* chooses, so "does a mirror exist for this
 * task" stops being state to keep in sync and becomes a fact about the id:
 * PUT is an upsert, DELETE returning 404 means already gone, and a half-written
 * mirror self-heals on the next reconcile instead of leaking an event nobody
 * can find.
 */
export function mirrorUid(kind: MirrorKind, rowId: string): string {
  return `${MIRROR_UID_PREFIX}${kind}-${rowId}`;
}

/** Whether an inbound event is one of Nuvo's own mirrored blocks coming back. */
export function isMirrorUid(uid: string | null | undefined): boolean {
  return typeof uid === "string" && uid.startsWith(MIRROR_UID_PREFIX);
}

/** Where a mirror resource lives inside a CalDAV collection. */
export function mirrorHref(calendarUrl: string, uid: string): string {
  return `${calendarUrl.replace(/\/$/, "")}/${uid}.ics`;
}

/** The row shape both mirrors need. Structural, so `tasks` and `slots` rows
 *  both satisfy it without either function importing the other's types. */
export interface MirrorableRow {
  title?: string | null;
  status?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
}

/**
 * Does this row belong on the calendar right now?
 *
 * One predicate for both providers, and the reconciler's whole contract: true
 * means "make the provider match", false means "make sure nothing is there".
 * A task that was unscheduled, trashed or rolled falls out of it and its mirror
 * is torn down — which is why this is a *reconciler* and not a command handler.
 */
export function shouldMirror(row: MirrorableRow, kind: MirrorKind): boolean {
  if (!row.start_time) return false;
  if (kind === "slot") return true; // a slot IS a held block; it has no status
  return row.status === "planned" || row.status === "done";
}

/** What the mirrored block is called on the user's calendar. The ✓ is the only
 *  signal a glance at a phone gets that the block was actually done, so it
 *  belongs in the shared rule rather than in one provider's function. */
export function mirrorTitle(row: MirrorableRow, fallback = "Block"): string {
  const base = (row.title ?? "").trim() || fallback;
  return row.status === "done" ? `✓ ${base}` : base;
}

/** The block's span. Defaults match the app's: 30 minutes for a task, 60 for a
 *  slot, which is what the row's own default duration means when it's null. */
export function mirrorSpan(
  row: MirrorableRow,
  kind: MirrorKind,
): { startISO: string; endISO: string } {
  const start = new Date(row.start_time!);
  const mins = row.duration_minutes ?? (kind === "slot" ? 60 : 30);
  return {
    startISO: start.toISOString(),
    endISO: new Date(start.getTime() + mins * 60_000).toISOString(),
  };
}

/** Drop Nuvo's own mirror calendar out of a discovered CalDAV collection list.
 *
 *  Matched by URL, never by name — a user is entitled to their own calendar
 *  called "Nuvo", and deleting or shadowing it because of a name collision is
 *  not a mistake we get to make. `isMirrorUid` is the second net for the case
 *  where the stored URL is missing. */
export function withoutMirrorCalendar<T extends { url: string }>(
  calendars: T[],
  mirrorUrl: string | null | undefined,
): T[] {
  if (!mirrorUrl) return calendars;
  const norm = (u: string) => u.replace(/\/$/, "");
  return calendars.filter((c) => norm(c.url) !== norm(mirrorUrl));
}
