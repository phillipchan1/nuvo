// Read sync for iCloud (Apple Calendar) accounts over CalDAV.
// Runs every 15 minutes from pg_cron; also kicked right after connect and by
// calendar-refresh. CalDAV has no cheap delta, so each run re-queries the window
// per calendar, upserts every event, then sweeps anything not seen this run
// (handles cancellations / deletions upstream).
import { admin, handleOptions, json, logSync, readSecret } from "../_shared/admin.ts";
import { type ExternalEventRow, parseIcs } from "../_shared/ics.ts";
import { discoverCalendars, fetchEvents } from "../_shared/caldav.ts";
import { isMirrorUid, withoutMirrorCalendar } from "../_shared/mirror.ts";
import { reconcileEvents } from "../_shared/eventSync.ts";
import { loadAccountsPaged, markSyncResult } from "../_shared/syncSchedule.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;

interface IcloudAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token_secret_id: string | null;
  needs_reconnect: boolean;
  /** The dedicated collection Nuvo mirrors blocks into. Excluded from the sync
   *  below — it is Nuvo's own writing, not the user's calendar. */
  mirror_calendar_id: string | null;
  // deno-lint-ignore no-explicit-any
  calendars: any[] | null;
}

async function syncAccount(account: IcloudAccount): Promise<void> {
  const fail = async (why: string) => {
    await admin.from("calendar_accounts").update({ needs_reconnect: true }).eq("id", account.id);
    throw new Error(why);
  };

  if (!account.refresh_token_secret_id) return await fail("no app-specific password stored");
  const password = await readSecret(account.refresh_token_secret_id);
  if (!password) return await fail("app-specific password missing from vault");

  const username = account.email;
  const windowStart = new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000);
  const windowEnd = new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000);
  const runStamp = new Date().toISOString();

  // Re-discover so new/renamed calendars are picked up between polls.
  let calendars;
  try {
    calendars = await discoverCalendars(username, password);
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }

  // Nuvo's own mirror calendar is not the user's calendar and must never come
  // back in as external events. Without this, every mirrored task would exist
  // TWICE on every surface — once as its own block and once as an "event" — and
  // both copies would count as busy, which is the double-count that put four
  // projects' hours in the wrong place in the domain time ledger (D-085).
  //
  // Matched by URL, never by display name: a user is entitled to their own
  // calendar called "Nuvo". The UID prefix below is the second net, for the
  // case where the stored URL is missing.
  calendars = withoutMirrorCalendar(calendars, account.mirror_calendar_id);

  // Refresh the stored calendars list when discovery changed (keeps colors/names
  // current and surfaces newly-created calendars in Settings).
  const nextCals = calendars.map((c) => ({ id: c.url, summary: c.displayName, color: c.color, visible: true }));
  if (JSON.stringify(nextCals) !== JSON.stringify(account.calendars ?? [])) {
    await admin.from("calendar_accounts").update({ calendars: nextCals }).eq("id", account.id);
  }

  // Collect every calendar's events before reconciling: the sweep is
  // account-wide, so it can only run once the whole account has been fetched —
  // reconciling per calendar would let a calendar that failed mid-pass look
  // empty and take its events with it.
  const rows: ExternalEventRow[] = [];
  for (const cal of calendars) {
    const events = await fetchEvents(cal.url, username, password, windowStart, windowEnd);
    for (const ev of events) {
      const { rows: parsed } = parseIcs(ev.ics, {
        userId: account.user_id,
        accountId: account.id,
        windowStart,
        windowEnd,
        runStamp,
        calendarId: cal.url,
        ownerEmail: account.email,
      });
      for (const row of parsed) {
        // Second net: a resource Nuvo wrote, wherever it turned up. Cheap, and
        // it holds even if `mirror_calendar_id` is lost or the user drags a
        // mirrored block into another calendar.
        if (isMirrorUid(row.provider_event_id)) continue;
        row.raw = { ...row.raw, caldav_href: ev.href, caldav_etag: ev.etag };
        rows.push(row);
      }
    }
  }

  // Write only genuinely-changed rows; delete only what CalDAV stopped
  // returning. CalDAV has no delta, so this pass sees the whole window every 15
  // minutes — without the content check that was a full table rewrite per poll.
  // The caldav_etag rides in `raw` and is part of the hash, so an event edited
  // upstream still refreshes even if its title and times are unchanged.
  const { written, deleted, unchanged } = await reconcileEvents(
    { accountId: account.id },
    rows,
    { sweep: true },
  );
  if (written || deleted) {
    await logSync(
      "icloud",
      "reconcile",
      "ok",
      `${written} written, ${deleted} deleted, ${unchanged} unchanged`,
      account.user_id,
    );
  }

  if (account.needs_reconnect) {
    await admin.from("calendar_accounts").update({ needs_reconnect: false }).eq("id", account.id);
  }
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const { accountId } = await req.json().catch(() => ({}));

  try {
    // Normal path: the dispatcher hands us exactly one accountId. The
    // no-argument form is the manual "sync everything" fallback and pages
    // rather than trusting an unbounded select.
    const accounts = (await loadAccountsPaged("icloud", accountId)) as IcloudAccount[];

    for (const account of accounts) {
      try {
        await syncAccount(account);
        await markSyncResult(account.id, true);
        await logSync("icloud", "sync", "ok", undefined, account.user_id);
      } catch (e) {
        await markSyncResult(account.id, false);
        await logSync("icloud", "sync", "error", e instanceof Error ? e.message : String(e), account.user_id);
      }
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("icloud", "sync", "error", msg);
    return json({ error: msg }, 500);
  }
});
