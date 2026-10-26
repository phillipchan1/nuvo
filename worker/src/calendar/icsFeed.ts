import type { Sql } from "../db.ts";
import type { Env } from "../env.ts";
import { reconcileEvents } from "../lib/eventSync.ts";
import { parseIcs } from "../lib/ics.ts";
import { isBlockedHost, rewriteFeedUrl } from "../lib/ssrf.ts";
import { loadAccountsPaged, logSync, markSyncResult, openAccountSecret, updateAccount } from "./store.ts";
import type { CalendarAccount } from "./types.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;

export function assertPublicFeedUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== "string") return { ok: false, error: "A valid https calendar URL is required" };
  const feedUrl = rewriteFeedUrl(raw);
  if (!/^https:\/\//i.test(feedUrl)) return { ok: false, error: "A valid https calendar URL is required" };
  let host: string;
  try {
    host = new URL(feedUrl).hostname;
  } catch {
    return { ok: false, error: "Malformed URL" };
  }
  if (isBlockedHost(host)) return { ok: false, error: "That host isn't allowed" };
  return { ok: true, url: feedUrl };
}

export async function syncIcsAccount(sql: Sql, account: CalendarAccount, env: Env): Promise<void> {
  const fail = async (why: string): Promise<never> => {
    await updateAccount(sql, account.id, account.user_id, { needs_reconnect: true });
    throw new Error(why);
  };

  const feedUrl = await openAccountSecret(account, env.TOKEN_ENC_KEY_V1);
  if (!feedUrl) return await fail("no feed url stored");
  const guarded = assertPublicFeedUrl(feedUrl);
  if (!guarded.ok) return await fail(guarded.error);

  const res = await fetch(guarded.url, { headers: { Accept: "text/calendar" } });
  if (!res.ok) return await fail(`feed fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) return await fail("feed no longer returns iCalendar");

  const runStamp = new Date().toISOString();
  const { rows } = parseIcs(text, {
    userId: account.user_id,
    accountId: account.id,
    windowStart: new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000),
    windowEnd: new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000),
    runStamp,
    ownerEmail: account.email,
  });

  const { written, deleted, unchanged } = await reconcileEvents(
    sql,
    { accountId: account.id, userId: account.user_id },
    rows,
    { sweep: true },
  );
  if (written || deleted) {
    await logSync(
      sql,
      "ics",
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

export async function runIcsSync(
  sql: Sql,
  env: Env,
  accountId?: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const accounts = await loadAccountsPaged(sql, "ics", accountId);
    for (const account of accounts) {
      try {
        await syncIcsAccount(sql, account, env);
        await markSyncResult(sql, account.id, true);
        await logSync(sql, "ics", "sync", "ok", undefined, account.user_id);
      } catch (e) {
        await markSyncResult(sql, account.id, false);
        await logSync(sql, "ics", "sync", "error", e instanceof Error ? e.message : String(e), account.user_id);
      }
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(sql, "ics", "sync", "error", msg);
    return { error: msg };
  }
}
