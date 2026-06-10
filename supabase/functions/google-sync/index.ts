// Google Calendar sync: initial full import, incremental sync-token pulls,
// watch-channel setup/renewal, and a 5-minute polling fallback for accounts
// whose webhook setup failed. Sync reliability beats elegance.
import { admin, handleOptions, json, logSync } from "../_shared/admin.ts";
import {
  type CalendarEntry,
  type GoogleAccount,
  gFetch,
  loadGoogleAccounts,
  mapGoogleEvent,
} from "../_shared/google.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;
const CHANNEL_RENEW_AHEAD_MS = 48 * 3600_000;

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
  let pageToken: string | null = null;
  let syncToken = cal.sync_token ?? null;
  const fullParams = () => {
    const p = new URLSearchParams({
      singleEvents: "true",
      maxResults: "250",
      timeMin: new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000).toISOString(),
      timeMax: new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000).toISOString(),
    });
    return p;
  };

  let usingToken = Boolean(syncToken);
  do {
    const params = usingToken
      ? new URLSearchParams({ syncToken: syncToken!, maxResults: "250" })
      : fullParams();
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(
      account,
      `/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
    );
    if (res.status === 410 && usingToken) {
      // sync token expired — restart with a full window
      usingToken = false;
      syncToken = null;
      pageToken = null;
      await admin
        .from("external_events")
        .delete()
        .eq("account_id", account.id)
        .eq("calendar_id", cal.id);
      continue;
    }
    if (!res.ok) throw new Error(`events list ${cal.id}: ${res.status} ${await res.text()}`);
    const body = await res.json();

    const upserts = [];
    const deletes: string[] = [];
    for (const e of body.items ?? []) {
      if (e.status === "cancelled") {
        deletes.push(e.id);
        continue;
      }
      const row = mapGoogleEvent(account, cal.id, e);
      if (row) upserts.push(row);
    }
    if (upserts.length) {
      const { error } = await admin
        .from("external_events")
        .upsert(upserts, { onConflict: "account_id,calendar_id,provider_event_id" });
      if (error) throw error;
    }
    if (deletes.length) {
      await admin
        .from("external_events")
        .delete()
        .eq("account_id", account.id)
        .eq("calendar_id", cal.id)
        .in("provider_event_id", deletes);
    }

    pageToken = body.nextPageToken ?? null;
    if (!pageToken && body.nextSyncToken) cal.sync_token = body.nextSyncToken;
  } while (pageToken);
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
        // Fallback only for calendars without a live webhook channel
        const stale = visible.filter(
          (c) => !c.channel_expires_at || new Date(c.channel_expires_at) < new Date(),
        );
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
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", `sync-${mode}`, "error", msg);
    return json({ error: msg }, 500);
  }
});
