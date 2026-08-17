// Google Calendar sync: initial full import, incremental sync-token pulls,
// watch-channel setup/renewal, and a 5-minute polling fallback that catches up
// any calendar a webhook didn't refresh (channels can go silent before they
// expire). Sync reliability beats elegance.
import { admin, handleOptions, json, logSync } from "../_shared/admin.ts";
import {
  type CalendarEntry,
  type GoogleAccount,
  fetchGoogleSeriesInstances,
  gFetch,
  isGoogleSeriesMaster,
  loadGoogleAccounts,
  mapGoogleEvent,
} from "../_shared/google.ts";
import { type EventRow, reconcileEvents } from "../_shared/eventSync.ts";
import { markSyncResult } from "../_shared/syncSchedule.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;
const CHANNEL_RENEW_AHEAD_MS = 48 * 3600_000;
// Poll catches up any calendar not synced within this window. Just under the
// 5-minute cron cadence so a calendar with a dead webhook is re-synced on the
// next tick rather than skipped, while one a webhook just refreshed is left be.
const POLL_STALE_MS = 4 * 60_000;

async function saveCalendars(account: GoogleAccount) {
  const minExpiry = account.calendars
    .map((c) => c.channel_expires_at)
    .filter(Boolean)
    .sort()[0];
  await admin
    .from("calendar_accounts")
    .update({ calendars: account.calendars, webhook_expires_at: minExpiry ?? null })
    .eq("id", account.id);
}

/** Import one calendar. Uses the stored sync token when present; on 410 the
 *  token has expired and we fall back to a windowed full import. */
async function syncCalendar(account: GoogleAccount, cal: CalendarEntry): Promise<void> {
  const windowStartISO = new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000).toISOString();
  const windowEndISO = new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000).toISOString();
  // singleEvents MUST be on every pull — full and incremental — or Google
  // returns series masters (recurrence[] but no recurringEventId) and we store
  // one phantom block with no future weeks.
  const listParams = (syncToken?: string | null) => {
    const params = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
    if (syncToken) params.set("syncToken", syncToken);
    else {
      params.set("timeMin", windowStartISO);
      params.set("timeMax", windowEndISO);
    }
    return params;
  };

  let pageToken: string | null = null;
  let syncToken = cal.sync_token ?? null;
  let usingToken = Boolean(syncToken);

  // A full window import only ever *adds* events, so it needs an explicit
  // reconcile to remove deletions — and once the sync token advances past a
  // missed cancellation, incremental pulls never see it either, leaving the row
  // permanently stuck. The reconcile is set-based: whatever the pass didn't see
  // is gone. (It used to be a `last_synced_at` watermark, which stopped working
  // the moment unchanged rows were no longer rewritten — see eventSync.ts.)
  let reconcileWindow = !usingToken;
  // Every event this pass saw, accumulated across pages. A full import can span
  // many pages and the sweep can only run once all of them are in — reconciling
  // page by page would make page 1's rows look like the whole calendar.
  let seen: EventRow[] = [];

  do {
    const params = listParams(usingToken ? syncToken : null);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(
      account,
      `/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
    );
    if (res.status === 410 && usingToken) {
      // sync token expired — restart with a full window and reconcile at the
      // end. Drop anything the token pass already collected: the full import
      // re-reads the whole window, and keeping partial delta rows would make
      // the sweep's "everything I saw" set wrong.
      usingToken = false;
      syncToken = null;
      pageToken = null;
      reconcileWindow = true;
      seen = [];
      continue;
    }
    if (!res.ok) throw new Error(`events list ${cal.id}: ${res.status} ${await res.text()}`);
    const body = await res.json();

    const deletes: string[] = [];
    for (const e of body.items ?? []) {
      if (e.status === "cancelled") {
        deletes.push(e.id);
        continue;
      }
      if (isGoogleSeriesMaster(e)) {
        // Master slipped through — expand to instances and drop the master row.
        deletes.push(e.id as string);
        const instances = await fetchGoogleSeriesInstances(
          account,
          cal.id,
          e.id as string,
          windowStartISO,
          windowEndISO,
        );
        seen.push(...instances);
        continue;
      }
      const row = mapGoogleEvent(account, cal.id, e);
      if (row) seen.push(row);
    }
    // Cancellations are explicit tombstones in both modes — apply them as they
    // arrive rather than waiting on the sweep, which only runs for full imports.
    if (deletes.length) {
      const { error: delErr } = await admin
        .from("external_events")
        .delete()
        .eq("account_id", account.id)
        .eq("calendar_id", cal.id)
        .in("provider_event_id", deletes);
      if (delErr) throw delErr;
    }

    pageToken = body.nextPageToken ?? null;
    if (!pageToken && body.nextSyncToken) cal.sync_token = body.nextSyncToken;
  } while (pageToken);

  // Write only genuinely-changed rows. An incremental pull usually returns an
  // empty delta and writes nothing; even a full re-import after a 410 now
  // rewrites only events that actually differ, instead of the whole window.
  //
  // The sweep runs only for a full import, where "everything upstream still
  // has" is known — an incremental delta says nothing about events it didn't
  // mention, so sweeping there would delete the entire calendar. It stays
  // bounded to the import window so out-of-window rows (never fetched) survive,
  // and a mid-pass throw skips it entirely, so a partial import never deletes
  // real events.
  await reconcileEvents(
    reconcileWindow
      ? {
          accountId: account.id,
          calendarId: cal.id,
          sweepFrom: windowStartISO,
          sweepTo: windowEndISO,
        }
      : { accountId: account.id, calendarId: cal.id },
    seen,
    { sweep: reconcileWindow },
  );

  cal.last_synced_at = new Date().toISOString();
}

/** Create (or renew) the push notification channel for one calendar. */
async function watchCalendar(account: GoogleAccount, cal: CalendarEntry): Promise<void> {
  // Stop a previous channel if we have one
  if (cal.channel_id && cal.resource_id) {
    await gFetch(account, "/channels/stop", {
      method: "POST",
      body: JSON.stringify({ id: cal.channel_id, resourceId: cal.resource_id }),
    }).catch(() => {});
  }
  const channelId = crypto.randomUUID();
  const res = await gFetch(account, `/calendars/${encodeURIComponent(cal.id)}/events/watch`, {
    method: "POST",
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-webhook`,
      token: `${account.id}:${cal.id}`,
    }),
  });
  if (!res.ok) {
    // Webhook setup can legitimately fail (e.g. unverified domain). The
    // 5-minute polling cron covers these accounts — log and move on.
    await logSync("google", "watch-setup", "error", `${cal.id}: ${await res.text()}`, account.user_id);
    cal.channel_id = null;
    cal.resource_id = null;
    cal.channel_expires_at = null;
    return;
  }
  const body = await res.json();
  cal.channel_id = channelId;
  cal.resource_id = body.resourceId ?? null;
  cal.channel_expires_at = body.expiration
    ? new Date(Number(body.expiration)).toISOString()
    : null;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const { mode = "poll", accountId, calendarId } = await req.json().catch(() => ({}));

  try {
    const accounts = await loadGoogleAccounts(accountId);
    for (const account of accounts) {
      if (account.needs_reconnect && mode !== "full") continue;
      const visible = account.calendars.filter((c) => c.visible);

      // Per-account isolation. This loop runs over EVERY account in the system
      // on a cron tick, so an unhandled throw here (one expired token, one
      // calendar Google 500s on) used to abort the whole invocation and every
      // account after it in the list silently stopped syncing. Contain the
      // failure to the account that caused it — m365-sync and ics-sync already
      // do this; google-sync was the outlier.
      try {
        if (mode === "full") {
          for (const cal of visible) {
            cal.sync_token = null;
            await syncCalendar(account, cal);
            await watchCalendar(account, cal);
          }
          await saveCalendars(account);
          await logSync("google", "full-sync", "ok", undefined, account.user_id);
        } else if (mode === "incremental") {
          for (const cal of visible) {
            if (calendarId && cal.id !== calendarId) continue;
            await syncCalendar(account, cal);
          }
          await saveCalendars(account);
          await logSync("google", "incremental-sync", "ok", undefined, account.user_id);
        } else if (mode === "poll") {
          // Safety net for calendars the webhook didn't refresh. A registered,
          // unexpired channel is NOT proof Google is still delivering — channels
          // go silent and sync then freezes with no error. So poll by freshness,
          // not by channel state: catch up anything not synced this interval.
          // Webhook-fresh calendars are skipped; the rest get a cheap incremental
          // pull (sync token → usually an empty delta).
          const stale = visible.filter((c) => {
            const last = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0;
            return Date.now() - last > POLL_STALE_MS;
          });
          if (stale.length === 0) continue;
          for (const cal of stale) await syncCalendar(account, cal);
          await saveCalendars(account);
          await logSync("google", "poll-sync", "ok", undefined, account.user_id);
        } else if (mode === "renew-channels") {
          let touched = false;
          for (const cal of visible) {
            const exp = cal.channel_expires_at ? new Date(cal.channel_expires_at).getTime() : 0;
            if (exp < Date.now() + CHANNEL_RENEW_AHEAD_MS) {
              await watchCalendar(account, cal);
              touched = true;
            }
          }
          if (touched) await saveCalendars(account);
          await logSync("google", "renew-channels", "ok", undefined, account.user_id);
        }
        // Channel renewal is its own daily job and says nothing about whether
        // event sync is healthy — don't let it reset this account's backoff.
        if (mode !== "renew-channels") await markSyncResult(account.id, true);
      } catch (e) {
        if (mode !== "renew-channels") await markSyncResult(account.id, false);
        await logSync(
          "google",
          `sync-${mode}`,
          "error",
          e instanceof Error ? e.message : String(e),
          account.user_id,
        );
      }
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", `sync-${mode}`, "error", msg);
    return json({ error: msg }, 500);
  }
});
