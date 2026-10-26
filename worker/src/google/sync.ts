import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import {
  SYNC_WINDOW_FUTURE_DAYS,
  SYNC_WINDOW_PAST_DAYS,
} from "../../../supabase/functions/_shared/syncWindow.ts";
import type { EventRow } from "../lib/eventHash.ts";
import { deleteProviderEvents, reconcileEvents } from "./eventSync.ts";
import {
  listGoogleAccountIds,
  loadGoogleAccountById,
  logSync,
  markSyncResult,
  saveCalendars,
} from "./owned.ts";
import { gFetch, isGoogleSeriesMaster, mapGoogleEvent } from "./tokens.ts";
import {
  CHANNEL_RENEW_AHEAD_MS,
  POLL_STALE_MS,
  type CalendarEntry,
  type GoogleAccount,
} from "./types.ts";

export type SyncMode = "full" | "incremental" | "poll" | "renew-channels" | "resubscribe";

export function workerOrigin(env: Env, reqUrl?: string): string {
  const fromEnv = (env.BETTER_AUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  if (reqUrl) return new URL(reqUrl).origin;
  return "";
}

export function webhookAddress(env: Env, reqUrl?: string): string {
  return `${workerOrigin(env, reqUrl)}/functions/v1/google-webhook`;
}

export function oauthSelfUrl(env: Env, reqUrl?: string): string {
  return `${workerOrigin(env, reqUrl)}/functions/v1/google-oauth`;
}

async function fetchGoogleSeriesInstances(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  calendarId: string,
  masterId: string,
  timeMin: string,
  timeMax: string,
): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(masterId)}/instances?${params}`,
    );
    if (!res.ok) throw new Error(`instances ${masterId}: ${res.status}`);
    const body = (await res.json()) as { items?: Record<string, unknown>[]; nextPageToken?: string };
    for (const inst of body.items ?? []) {
      const row = mapGoogleEvent(account, calendarId, inst);
      if (row) rows.push(row);
    }
    pageToken = body.nextPageToken ?? null;
  } while (pageToken);
  return rows;
}

async function syncCalendar(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  cal: CalendarEntry,
): Promise<void> {
  const windowStartISO = new Date(Date.now() - SYNC_WINDOW_PAST_DAYS * 86400_000).toISOString();
  const windowEndISO = new Date(Date.now() + SYNC_WINDOW_FUTURE_DAYS * 86400_000).toISOString();
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
  let reconcileWindow = !usingToken;
  let seen: EventRow[] = [];

  do {
    const params = listParams(usingToken ? syncToken : null);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
    );
    if (res.status === 410 && usingToken) {
      usingToken = false;
      syncToken = null;
      pageToken = null;
      reconcileWindow = true;
      seen = [];
      continue;
    }
    if (!res.ok) throw new Error(`events list ${cal.id}: ${res.status}`);
    const body = (await res.json()) as {
      items?: Record<string, unknown>[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    const deletes: string[] = [];
    for (const e of body.items ?? []) {
      if (e.status === "cancelled") {
        deletes.push(String(e.id));
        continue;
      }
      if (isGoogleSeriesMaster(e)) {
        deletes.push(e.id as string);
        const instances = await fetchGoogleSeriesInstances(
          sql,
          env,
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
    if (deletes.length) {
      await deleteProviderEvents(sql, account.id, account.user_id, cal.id, deletes);
    }

    pageToken = body.nextPageToken ?? null;
    if (!pageToken && body.nextSyncToken) cal.sync_token = body.nextSyncToken;
  } while (pageToken);

  await reconcileEvents(
    sql,
    reconcileWindow
      ? {
          accountId: account.id,
          userId: account.user_id,
          calendarId: cal.id,
          sweepFrom: windowStartISO,
          sweepTo: windowEndISO,
        }
      : { accountId: account.id, userId: account.user_id, calendarId: cal.id },
    seen,
    { sweep: reconcileWindow },
  );
  cal.last_synced_at = new Date().toISOString();
}

/** Create or renew the push channel. `force` re-watches even when unexpired (cutover flip). */
export async function watchCalendar(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  cal: CalendarEntry,
  reqUrl?: string,
): Promise<void> {
  if (cal.channel_id && cal.resource_id) {
    await gFetch(sql, env, account, "/channels/stop", {
      method: "POST",
      body: JSON.stringify({ id: cal.channel_id, resourceId: cal.resource_id }),
    }).catch(() => undefined);
  }
  const channelId = crypto.randomUUID();
  const address = webhookAddress(env, reqUrl);
  const res = await gFetch(sql, env, account, `/calendars/${encodeURIComponent(cal.id)}/events/watch`, {
    method: "POST",
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address,
      token: `${account.id}:${cal.id}`,
    }),
  });
  if (!res.ok) {
    await logSync(sql, "google", "watch-setup", "error", `${cal.id}: ${res.status}`, account.user_id);
    cal.channel_id = null;
    cal.resource_id = null;
    cal.channel_expires_at = null;
    return;
  }
  const body = (await res.json()) as { resourceId?: string; expiration?: string | number };
  cal.channel_id = channelId;
  cal.resource_id = body.resourceId ?? null;
  cal.channel_expires_at = body.expiration ? new Date(Number(body.expiration)).toISOString() : null;
}

async function runOneAccount(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  mode: SyncMode,
  calendarId?: string,
  reqUrl?: string,
): Promise<void> {
  if (account.needs_reconnect && mode !== "full" && mode !== "resubscribe") return;
  const visible = account.calendars.filter((c) => c.visible);

  try {
    if (mode === "full") {
      for (const cal of visible) {
        cal.sync_token = null;
        await syncCalendar(sql, env, account, cal);
        await watchCalendar(sql, env, account, cal, reqUrl);
      }
      await saveCalendars(sql, account);
      await logSync(sql, "google", "full-sync", "ok", undefined, account.user_id);
    } else if (mode === "incremental") {
      for (const cal of visible) {
        if (calendarId && cal.id !== calendarId) continue;
        await syncCalendar(sql, env, account, cal);
      }
      await saveCalendars(sql, account);
      await logSync(sql, "google", "incremental-sync", "ok", undefined, account.user_id);
    } else if (mode === "poll") {
      const stale = visible.filter((c) => {
        const last = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0;
        return Date.now() - last > POLL_STALE_MS;
      });
      if (stale.length === 0) return;
      for (const cal of stale) await syncCalendar(sql, env, account, cal);
      await saveCalendars(sql, account);
      await logSync(sql, "google", "poll-sync", "ok", undefined, account.user_id);
    } else if (mode === "renew-channels") {
      let touched = false;
      for (const cal of visible) {
        const exp = cal.channel_expires_at ? new Date(cal.channel_expires_at).getTime() : 0;
        if (exp < Date.now() + CHANNEL_RENEW_AHEAD_MS) {
          await watchCalendar(sql, env, account, cal, reqUrl);
          touched = true;
        }
      }
      if (touched) await saveCalendars(sql, account);
      await logSync(sql, "google", "renew-channels", "ok", undefined, account.user_id);
    } else if (mode === "resubscribe") {
      // Cutover flip: re-watch every visible calendar onto the Worker webhook.
      // Watch setup can fail (unverified domain); poll fallback still covers them.
      for (const cal of visible) {
        await watchCalendar(sql, env, account, cal, reqUrl);
      }
      await saveCalendars(sql, account);
      await logSync(sql, "google", "resubscribe-channels", "ok", undefined, account.user_id);
    }
    if (mode !== "renew-channels" && mode !== "resubscribe") {
      await markSyncResult(sql, account.id, account.user_id, true);
    }
  } catch (e) {
    if (mode !== "renew-channels" && mode !== "resubscribe") {
      await markSyncResult(sql, account.id, account.user_id, false);
    }
    await logSync(
      sql,
      "google",
      `sync-${mode}`,
      "error",
      e instanceof Error ? e.message : String(e),
      account.user_id,
    );
    throw e;
  }
}

export async function runGoogleSync(
  sql: Sql,
  env: Env,
  opts: { mode?: SyncMode; accountId?: string; calendarId?: string; userId?: string; reqUrl?: string },
): Promise<{ ok: true; accounts: number }> {
  const mode = opts.mode ?? "poll";
  const ids = await listGoogleAccountIds(sql, opts.accountId);
  let n = 0;
  for (const id of ids) {
    const account = await loadGoogleAccountById(sql, id);
    if (!account) continue;
    if (opts.userId && account.user_id !== opts.userId) continue;
    try {
      await runOneAccount(sql, env, account, mode, opts.calendarId, opts.reqUrl);
      n++;
    } catch {
      // Isolated per account — cron continues.
    }
  }
  return { ok: true, accounts: n };
}

export { fetchGoogleSeriesInstances };
