/**
 * Resolving *where* a user's blocks get mirrored, and writing one there.
 *
 * The pure decisions live in `mirror.ts`; this is the thin transport half —
 * the part `npm test` cannot reach, kept as small as it can be for exactly that
 * reason. Both `task-mirror` and `slot-mirror` call it, so the two reconcilers
 * cannot drift into different ideas of which account wins or how a CalDAV
 * mirror calendar gets stood up.
 *
 * ## Which account
 *
 * A Google account with a mirror calendar wins, because it is the one that was
 * always there and switching a returning user's blocks to a different calendar
 * would strand every block already on their phone. Otherwise the first writable
 * iCloud account gets it, standing the calendar up on first use.
 */
import { admin, logSync } from "./admin.ts";
import { type GoogleAccount, gFetch } from "./google.ts";
import { createCalendar, deleteEvent, discoverCalendarHome, putEvent } from "./caldav.ts";
import { buildEvent } from "./icalwrite.ts";
import { MIRROR_CALENDAR_DESCRIPTION, MIRROR_CALENDAR_NAME, mirrorHref, mirrorUid, type MirrorKind } from "./mirror.ts";

/** The collection slug under the CalDAV home. Stable — it is half the identity
 *  of every mirrored resource, so it can never be regenerated per call. */
const ICLOUD_MIRROR_SLUG = "nuvo-blocks";

export type MirrorTarget =
  | { provider: "google"; account: GoogleAccount; calendarId: string }
  | { provider: "icloud"; accountId: string; email: string; password: string; calendarUrl: string };

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/**
 * The account a user's blocks mirror to, or null if there is nowhere to put
 * them (no writable calendar account connected — the honest no-op).
 *
 * `readSecret` is injected rather than imported so this module stays free of
 * the Vault import in contexts that don't need it, and so a test can drive the
 * resolution order without a live secret store.
 */
export async function resolveMirrorTarget(
  userId: string,
  readSecret: (id: string | null) => Promise<string | null>,
): Promise<MirrorTarget | null> {
  // Google first — a returning user's blocks are already on that calendar, and
  // moving them to a new one would leave the old copies behind on their phone.
  const { data: googleAccounts } = await admin
    .from("calendar_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google")
    .not("mirror_calendar_id", "is", null)
    .limit(1);
  const google = googleAccounts?.[0] as GoogleAccount | undefined;
  if (google) {
    return { provider: "google", account: google, calendarId: google.mirror_calendar_id! };
  }

  const { data: icloudAccounts } = await admin
    .from("calendar_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "icloud")
    .eq("sync_direction", "two_way")
    .order("created_at", { ascending: true })
    .limit(1);
  const icloud = icloudAccounts?.[0] as Row | undefined;
  if (!icloud) return null;

  const password = await readSecret(icloud.refresh_token_secret_id ?? null);
  if (!password) return null;

  let calendarUrl = icloud.mirror_calendar_id as string | null;
  if (!calendarUrl) {
    // Stood up lazily rather than at connect time, so an account connected
    // before mirroring existed gets one without reconnecting. MKCALENDAR on an
    // existing collection answers 405, which `createCalendar` reads as "already
    // there" — so this is idempotent and safe to reach on any write.
    const home = await discoverCalendarHome(icloud.email as string, password);
    const made = await createCalendar(
      home,
      ICLOUD_MIRROR_SLUG,
      MIRROR_CALENDAR_NAME,
      icloud.email as string,
      password,
      MIRROR_CALENDAR_DESCRIPTION,
    );
    calendarUrl = made.url;
    await admin.from("calendar_accounts").update({ mirror_calendar_id: calendarUrl }).eq("id", icloud.id);
    await logSync("icloud", made.created ? "mirror-calendar-create" : "mirror-calendar-adopt", "ok", undefined, userId);
  }

  return {
    provider: "icloud",
    accountId: icloud.id as string,
    email: icloud.email as string,
    password,
    calendarUrl,
  };
}

export interface MirrorBlock {
  kind: MirrorKind;
  rowId: string;
  title: string;
  startISO: string;
  endISO: string;
  description?: string | null;
  /** IANA zone from the device. Google renders and DST-shifts the block by it;
   *  CalDAV gets UTC instants, so it only matters to Google. Never a constant —
   *  a home zone stamped on every user's block is D-082 exactly. */
  tz: string;
}

/**
 * Make the provider match — create or update the one resource that represents
 * this block. Returns the provider's event id when it has one worth storing
 * (Google), and null when the identity is derivable (CalDAV, where the href is
 * a pure function of the row id — see `mirrorUid`).
 */
export async function putMirror(
  target: MirrorTarget,
  block: MirrorBlock,
  /** Google only: the id already on file, so an update PATCHes instead of
   *  creating a duplicate. */
  knownGoogleEventId?: string | null,
): Promise<string | null> {
  if (target.provider === "icloud") {
    const uid = mirrorUid(block.kind, block.rowId);
    const ics = buildEvent({
      uid,
      title: block.title,
      startISO: block.startISO,
      endISO: block.endISO,
      description: block.description ?? null,
    });
    // A PUT with no If-Match is an upsert: create when absent, replace when
    // present. That is the whole reconcile for CalDAV.
    await putEvent(mirrorHref(target.calendarUrl, uid), ics, target.email, target.password);
    return null;
  }

  const calId = encodeURIComponent(target.calendarId);
  const body = JSON.stringify({
    summary: block.title,
    description: block.description || undefined,
    start: { dateTime: block.startISO, timeZone: block.tz },
    end: { dateTime: block.endISO, timeZone: block.tz },
  });

  if (knownGoogleEventId) {
    const res = await gFetch(
      target.account,
      `/calendars/${calId}/events/${encodeURIComponent(knownGoogleEventId)}`,
      { method: "PATCH", body },
    );
    if (res.ok) return knownGoogleEventId;
    if (res.status !== 404 && res.status !== 410) {
      throw new Error(`mirror update failed: ${res.status} ${await res.text()}`);
    }
    // fall through: the event vanished on Google's side — recreate.
  }

  const createRes = await gFetch(target.account, `/calendars/${calId}/events`, { method: "POST", body });
  if (!createRes.ok) throw new Error(`mirror create failed: ${createRes.status} ${await createRes.text()}`);
  return (await createRes.json()).id as string;
}

/** Make sure nothing is there. 404/410 are already-gone, not failures — which
 *  is what lets a torn-down mirror be re-torn-down safely. */
export async function deleteMirror(
  target: MirrorTarget,
  kind: MirrorKind,
  rowId: string,
  knownGoogleEventId?: string | null,
): Promise<void> {
  if (target.provider === "icloud") {
    const href = mirrorHref(target.calendarUrl, mirrorUid(kind, rowId));
    const status = await deleteEvent(href, target.email, target.password);
    if (status !== 204 && status !== 200 && status !== 404 && status !== 410) {
      throw new Error(`mirror delete failed: HTTP ${status}`);
    }
    return;
  }
  if (!knownGoogleEventId) return;
  const res = await gFetch(
    target.account,
    `/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(knownGoogleEventId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`mirror delete failed: ${res.status}`);
  }
}

/** Which provider label a mirror log line is filed under. */
export function mirrorProvider(target: MirrorTarget): "google" | "icloud" {
  return target.provider;
}
