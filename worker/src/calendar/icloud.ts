import type { Sql } from "../db.ts";
import type { Env } from "../env.ts";
import { discoverCalendars, fetchEvents } from "../lib/caldav.ts";
import { discoverAddressBooks, fetchContacts } from "../lib/carddav.ts";
import { writeContacts } from "../lib/contactsWrite.ts";
import { reconcileEvents } from "../lib/eventSync.ts";
import { parseIcs, type ExternalEventRow } from "../lib/ics.ts";
import { isMirrorUid, withoutMirrorCalendar } from "../lib/mirror.ts";
import { SYNC_WINDOW_FUTURE_DAYS, SYNC_WINDOW_PAST_DAYS } from "../lib/syncWindow.ts";
import {
  loadAccountsPaged,
  logSync,
  markSyncResult,
  openAccountSecret,
  updateAccount,
} from "./store.ts";
import type { CalendarAccount } from "./types.ts";

export async function syncIcloudAccount(sql: Sql, account: CalendarAccount, env: Env): Promise<void> {
  const fail = async (why: string): Promise<never> => {
    await updateAccount(sql, account.id, account.user_id, { needs_reconnect: true });
    throw new Error(why);
  };

  const password = await openAccountSecret(account, env.TOKEN_ENC_KEY_V1);
  if (!password) return await fail("no app-specific password stored");

  const windowStart = new Date(Date.now() - SYNC_WINDOW_PAST_DAYS * 86400_000);
  const windowEnd = new Date(Date.now() + SYNC_WINDOW_FUTURE_DAYS * 86400_000);
  const runStamp = new Date().toISOString();

  let calendars;
  try {
    calendars = await discoverCalendars(account.email, password);
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
  calendars = withoutMirrorCalendar(calendars, account.mirror_calendar_id);

  const nextCals = calendars.map((c) => ({
    id: c.url,
    summary: c.displayName,
    color: c.color,
    visible: true,
  }));
  if (JSON.stringify(nextCals) !== JSON.stringify(account.calendars ?? [])) {
    await updateAccount(sql, account.id, account.user_id, { calendars: nextCals });
  }

  const rows: ExternalEventRow[] = [];
  for (const cal of calendars) {
    const events = await fetchEvents(cal.url, account.email, password, windowStart, windowEnd);
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
        if (isMirrorUid(row.provider_event_id)) continue;
        row.raw = { ...row.raw, caldav_href: ev.href, caldav_etag: ev.etag };
        rows.push(row);
      }
    }
  }

  const { written, deleted, unchanged } = await reconcileEvents(
    sql,
    { accountId: account.id, userId: account.user_id },
    rows,
    { sweep: true },
  );
  if (written || deleted) {
    await logSync(
      sql,
      "icloud",
      "reconcile",
      "ok",
      `${written} written, ${deleted} deleted, ${unchanged} unchanged`,
      account.user_id,
    );
  }
  if (account.needs_reconnect) {
    await updateAccount(sql, account.id, account.user_id, { needs_reconnect: false });
  }
}

export async function runIcloudSync(
  sql: Sql,
  env: Env,
  accountId?: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const accounts = await loadAccountsPaged(sql, "icloud", accountId);
    for (const account of accounts) {
      try {
        await syncIcloudAccount(sql, account, env);
        await markSyncResult(sql, account.id, true);
        await logSync(sql, "icloud", "sync", "ok", undefined, account.user_id);
      } catch (e) {
        await markSyncResult(sql, account.id, false);
        await logSync(sql, "icloud", "sync", "error", e instanceof Error ? e.message : String(e), account.user_id);
      }
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(sql, "icloud", "sync", "error", msg);
    return { error: msg };
  }
}

async function syncIcloudContactsAccount(sql: Sql, account: CalendarAccount, env: Env): Promise<number> {
  const password = await openAccountSecret(account, env.TOKEN_ENC_KEY_V1);
  if (!password) throw new Error("no app-specific password stored");

  const books = await discoverAddressBooks(account.email, password);
  if (!books.length) return 0;

  const all: { email: string; displayName: string | null }[] = [];
  for (const book of books) {
    const cards = await fetchContacts(book.url, account.email, password);
    all.push(...cards.map((c) => ({ email: c.email, displayName: c.displayName })));
  }
  const result = await writeContacts(sql, account.user_id, account.id, "apple", all);
  if (result.sweepSkipped) {
    await logSync(
      sql,
      "icloud",
      "contacts",
      "error",
      "refused to sweep: address book came back empty over a populated store",
      account.user_id,
    );
  }
  return result.upserted;
}

export async function runIcloudContacts(
  sql: Sql,
  env: Env,
  accountId?: string,
): Promise<{ ok: true; contacts: number; failures: string[] } | { error: string }> {
  try {
    const accounts = await loadAccountsPaged(sql, "icloud", accountId);
    let total = 0;
    const failures: string[] = [];
    for (const account of accounts) {
      try {
        total += await syncIcloudContactsAccount(sql, account, env);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push("account failed");
        await logSync(sql, "icloud", "contacts", "error", msg, account.user_id);
      }
    }
    if (!failures.length) await logSync(sql, "icloud", "contacts", "ok");
    return { ok: true, contacts: total, failures };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(sql, "icloud", "contacts", "error", msg);
    return { error: msg };
  }
}
