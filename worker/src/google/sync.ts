import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { redactSecrets } from "../lib/redact.ts";
import {
  SYNC_WINDOW_FUTURE_DAYS,
  SYNC_WINDOW_PAST_DAYS,
} from "../../../supabase/functions/_shared/syncWindow.ts";
import type { EventRow } from "../lib/eventHash.ts";
import { deleteProviderEvents, reconcileEvents } from "./eventSync.ts";
import {
  dropCalendar,
  listGoogleAccountIds,
  loadGoogleAccountById,
  logSync,
  markSyncResult,
  saveCalendars,
} from "./owned.ts";
import { GoogleAuthError, gFetch, isGoogleSeriesMaster, mapGoogleEvent } from "./tokens.ts";
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

/** Google refused to list a calendar's events. Carries the status so the
 *  per-calendar runner can tell "this calendar is gone" from a blip. */
export class CalendarListError extends Error {
  readonly calendarId: string;
  readonly status: number;
  constructor(calendarId: string, status: number) {
    super(`events list ${calendarId}: ${status}`);
    this.calendarId = calendarId;
    this.status = status;
  }
}

/** Is this calendar really gone from the account — not just failing?
 *
 *  Two independent answers have to agree before Nuvo drops a calendar and its
 *  events: the events list said 404, AND the account's own calendar list no
 *  longer has it (the user deleted or unsubscribed it, or lost access). A 404
 *  from the list alone, or any doubt about the second call, keeps the calendar
 *  and records the error instead (D-243). */
export async function calendarIsGone(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  calendarId: string,
): Promise<boolean> {
  const res = await gFetch(sql, env, account, `/users/me/calendarList/${encodeURIComponent(calendarId)}`);
  return res.status === 404;
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

  // `for (;;)`, not `do … while (pageToken)`: the 410 branch below restarts the
  // listing with `continue`, and in a do/while `continue` jumps to the
  // condition — with pageToken just cleared, that EXITED the loop having
  // fetched nothing, then swept the window against zero events. Under
  // EMPTY_SWEEP_FLOOR stored rows that wiped the calendar's window; above it,
  // the mass-delete guard threw on every sync, forever, because the dead token
  // was never replaced (D-243).
  for (;;) {
    const params = listParams(usingToken ? syncToken : null);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gFetch(
      sql,
      env,
      account,
      `/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
    );
    if (res.status === 410 && usingToken) {
      // Sync token expired: re-list the whole window and sweep against it.
      usingToken = false;
      syncToken = null;
      cal.sync_token = null;
      pageToken = null;
      reconcileWindow = true;
      seen = [];
      continue;
    }
    if (!res.ok) throw new CalendarListError(cal.id, res.status);
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
    if (!pageToken) {
      if (body.nextSyncToken) cal.sync_token = body.nextSyncToken;
      break;
    }
  }

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

/** Create or renew the push channel. Returns false when watch fails (caller polls). */
export async function watchCalendar(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  cal: CalendarEntry,
  reqUrl?: string,
): Promise<boolean> {
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
    return false;
  }
  const body = (await res.json()) as { resourceId?: string; expiration?: string | number };
  cal.channel_id = channelId;
  cal.resource_id = body.resourceId ?? null;
  cal.channel_expires_at = body.expiration ? new Date(Number(body.expiration)).toISOString() : null;
  return true;
}

/** A sync run over several calendars where every calendar failed. Already
 *  logged per calendar; carried up so the account still backs off. */
class AllCalendarsFailed extends Error {
  readonly logged = true;
}

/**
 * Sync each calendar on its own (D-243). One calendar failing — a sweep the
 * mass-delete guard refused, a 403, a 5xx — is recorded on THAT calendar
 * (`sync_error`, plus a sync_log row) and the rest still sync and still get
 * their new sync tokens saved. Before, the first failure threw out of the loop:
 * the calendars after it never synced and no calendar's token was saved, so a
 * single broken calendar froze the whole account.
 *
 * A calendar Google says is gone (events 404 + absent from the calendar list)
 * is dropped with its events. An auth failure is account-wide and rethrown.
 * `after` runs for each calendar that wasn't dropped (e.g. re-watch).
 */
async function syncCalendars(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  mode: SyncMode,
  cals: CalendarEntry[],
  after?: (cal: CalendarEntry) => Promise<void>,
): Promise<{ synced: number; failed: number; dropped: number }> {
  let synced = 0;
  let failed = 0;
  let dropped = 0;
  let firstError: unknown = null;
  for (const cal of cals) {
    try {
      await syncCalendar(sql, env, account, cal);
      cal.sync_error = null;
      cal.sync_error_at = null;
      synced++;
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e;
      if (e instanceof CalendarListError && e.status === 404 && (await calendarIsGone(sql, env, account, cal.id).catch(() => false))) {
        if (cal.channel_id && cal.resource_id) {
          await gFetch(sql, env, account, "/channels/stop", {
            method: "POST",
            body: JSON.stringify({ id: cal.channel_id, resourceId: cal.resource_id }),
          }).catch(() => undefined);
        }
        const events = await dropCalendar(sql, account, cal.id);
        await logSync(sql, "google", "calendar-gone", "ok", `${cal.id}: dropped with ${events} events`, account.user_id);
        dropped++;
        continue;
      }
      const message = redactSecrets(e instanceof Error ? e.message : String(e));
      cal.sync_error = message;
      cal.sync_error_at = new Date().toISOString();
      await logSync(sql, "google", `sync-${mode}`, "error", message, account.user_id);
      failed++;
      firstError ??= e;
    }
    if (after) await after(cal);
  }
  if (failed > 0 && synced === 0) {
    // Persist what this run learned (errors, a cleared dead token) before
    // the account is marked failed.
    await saveCalendars(sql, account);
    const msg = firstError instanceof Error ? firstError.message : String(firstError);
    throw new AllCalendarsFailed(msg);
  }
  return { synced, failed, dropped };
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
      for (const cal of visible) cal.sync_token = null;
      await syncCalendars(sql, env, account, mode, visible, async (cal) => {
        await watchCalendar(sql, env, account, cal, reqUrl);
      });
      await saveCalendars(sql, account);
      await logSync(sql, "google", "full-sync", "ok", undefined, account.user_id);
    } else if (mode === "incremental") {
      const targets = calendarId ? visible.filter((c) => c.id === calendarId) : visible;
      await syncCalendars(sql, env, account, mode, targets);
      await saveCalendars(sql, account);
      await logSync(sql, "google", "incremental-sync", "ok", undefined, account.user_id);
    } else if (mode === "poll") {
      const stale = visible.filter((c) => {
        const last = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0;
        return Date.now() - last > POLL_STALE_MS;
      });
      if (stale.length === 0) return;
      await syncCalendars(sql, env, account, mode, stale);
      await saveCalendars(sql, account);
      await logSync(sql, "google", "poll-sync", "ok", undefined, account.user_id);
    } else if (mode === "renew-channels") {
      const unwatched: CalendarEntry[] = [];
      let touched = false;
      for (const cal of visible) {
        const exp = cal.channel_expires_at ? new Date(cal.channel_expires_at).getTime() : 0;
        if (exp < Date.now() + CHANNEL_RENEW_AHEAD_MS) {
          const watched = await watchCalendar(sql, env, account, cal, reqUrl);
          if (!watched) unwatched.push(cal);
          touched = true;
        }
      }
      if (unwatched.length) await syncCalendars(sql, env, account, mode, unwatched);
      if (touched) await saveCalendars(sql, account);
      await logSync(sql, "google", "renew-channels", "ok", undefined, account.user_id);
    } else if (mode === "resubscribe") {
      // Cutover flip: re-watch every visible calendar onto the Worker webhook.
      // Watch setup can fail (unverified domain); poll fallback still covers them.
      // Persist the cleared channel even if poll throws so we do not keep a dead watch.
      for (const cal of visible) {
        const watched = await watchCalendar(sql, env, account, cal, reqUrl);
        if (!watched) {
          try {
            await syncCalendar(sql, env, account, cal);
          } catch (e) {
            await logSync(
              sql,
              "google",
              "watch-poll-fallback",
              "error",
              redactSecrets(e instanceof Error ? e.message : String(e)),
              account.user_id,
            );
          }
        }
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
    if (e instanceof AllCalendarsFailed) throw e;
    await logSync(
      sql,
      "google",
      `sync-${mode}`,
      "error",
      redactSecrets(e instanceof Error ? e.message : String(e)),
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
