import type { Sql } from "../db.ts";
import type { Env } from "../env.ts";
import { reconcileEvents } from "../lib/eventSync.ts";
import { parseIcs } from "../lib/ics.ts";
import { assertPublicFeedUrl, fetchIcsFeed, isIcsAuthFailure } from "../lib/ssrf.ts";
import { loadAccountsPaged, loggedError, logSync, markSyncResult, openAccountSecret, updateAccount } from "./store.ts";
import type { CalendarAccount } from "./types.ts";

export { assertPublicFeedUrl, fetchIcsFeed } from "../lib/ssrf.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;

export async function syncIcsAccount(sql: Sql, account: CalendarAccount, env: Env): Promise<void> {
  const fail = async (why: string, reconnect = false): Promise<never> => {
    if (reconnect) {
      await updateAccount(sql, account.id, account.user_id, { needs_reconnect: true });
    }
    throw new Error(why);
  };

  const feedUrl = await openAccountSecret(account, env);
  if (!feedUrl) return await fail("no feed url stored");
  const guarded = await assertPublicFeedUrl(feedUrl);
  if (!guarded.ok) return await fail(guarded.error);

  const fetched = await fetchIcsFeed(guarded.url);
  if (!fetched.ok) {
    return await fail(fetched.error, isIcsAuthFailure(fetched.status, fetched.error));
  }
  if (!fetched.text.includes("BEGIN:VCALENDAR")) return await fail("feed no longer returns iCalendar");

  const runStamp = new Date().toISOString();
  const { rows } = parseIcs(fetched.text, {
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
  opts: { accountId?: string; userId?: string } = {},
): Promise<{ ok: true } | { error: string }> {
  try {
    const accounts = await loadAccountsPaged(sql, "ics", opts.accountId, opts.userId);
    for (const account of accounts) {
      if (account.needs_reconnect && !opts.accountId) continue;
      try {
        await syncIcsAccount(sql, account, env);
        await markSyncResult(sql, account.id, account.user_id, true);
        await logSync(sql, "ics", "sync", "ok", undefined, account.user_id);
      } catch (e) {
        await markSyncResult(sql, account.id, account.user_id, false);
        await logSync(sql, "ics", "sync", "error", loggedError(e), account.user_id);
      }
    }
    return { ok: true };
  } catch (e) {
    await logSync(sql, "ics", "sync", "error", loggedError(e), opts.userId);
    throw e;
  }
}
