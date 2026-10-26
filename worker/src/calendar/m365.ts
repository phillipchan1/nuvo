import type { Sql } from "../db.ts";
import type { Env } from "../env.ts";
import { GRAPH, getMsAccessToken } from "../lib/ms.ts";
import { deleteAccountEvents, deleteEventsByProviderIds, reconcileEvents, type EventRow } from "../lib/eventSync.ts";
import type { CalendarAccount } from "./types.ts";
import { loadAccountsPaged, logSync, markSyncResult, updateAccount } from "./store.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;

function mapGraphEvent(account: CalendarAccount, e: Record<string, unknown>): EventRow | null {
  const start = e.start as { dateTime?: string } | undefined;
  const end = e.end as { dateTime?: string } | undefined;
  if (!start?.dateTime || !end?.dateTime) return null;
  const startAt = start.dateTime.endsWith("Z") ? start.dateTime : `${start.dateTime}Z`;
  const endAt = end.dateTime.endsWith("Z") ? end.dateTime : `${end.dateTime}Z`;
  const location = e.location as { displayName?: string } | undefined;
  return {
    user_id: account.user_id,
    account_id: account.id,
    provider_event_id: String(e.id),
    calendar_id: "primary",
    title: (e.subject as string) || "(no title)",
    start_at: startAt,
    end_at: endAt,
    all_day: Boolean(e.isAllDay),
    location: location?.displayName || null,
    busy: e.showAs !== "free",
    raw: e,
    last_synced_at: new Date().toISOString(),
  };
}

export async function syncM365Account(sql: Sql, account: CalendarAccount, env: Env): Promise<void> {
  const token = await getMsAccessToken(sql, account, env);

  let url = account.delta_link;
  if (!url) {
    const start = new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000).toISOString();
    const end = new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000).toISOString();
    url = `${GRAPH}/me/calendarView/delta?startDateTime=${start}&endDateTime=${end}`;
    await deleteAccountEvents(sql, account.id, account.user_id);
  }

  let deltaLink: string | null = null;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 410) {
      await updateAccount(sql, account.id, account.user_id, { delta_link: null });
      throw new Error("delta link expired; baseline reset");
    }
    if (!res.ok) throw new Error(`calendarView delta: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      value?: Record<string, unknown>[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };

    const upserts: EventRow[] = [];
    const deletes: string[] = [];
    for (const e of body.value ?? []) {
      if (e["@removed"]) {
        deletes.push(String(e.id));
        continue;
      }
      const row = mapGraphEvent(account, e);
      if (row) upserts.push(row);
    }
    if (upserts.length) {
      await reconcileEvents(sql, { accountId: account.id, userId: account.user_id, calendarId: "primary" }, upserts, {
        sweep: false,
      });
    }
    if (deletes.length) {
      await deleteEventsByProviderIds(sql, account.id, account.user_id, deletes);
    }

    url = body["@odata.nextLink"] ?? null;
    deltaLink = body["@odata.deltaLink"] ?? deltaLink;
  }

  if (deltaLink) {
    await updateAccount(sql, account.id, account.user_id, { delta_link: deltaLink });
  }
}

export async function runM365Sync(
  sql: Sql,
  env: Env,
  accountId?: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const accounts = await loadAccountsPaged(sql, "m365", accountId);
    for (const account of accounts) {
      if (account.needs_reconnect && !accountId) continue;
      try {
        await syncM365Account(sql, account, env);
        await markSyncResult(sql, account.id, true);
        await logSync(sql, "m365", "delta-sync", "ok", undefined, account.user_id);
      } catch (e) {
        await markSyncResult(sql, account.id, false);
        await logSync(sql, "m365", "delta-sync", "error", e instanceof Error ? e.message : String(e), account.user_id);
      }
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(sql, "m365", "sync", "error", msg);
    return { error: msg };
  }
}
