// Read-only sync for subscribed iCalendar (.ics) feeds.
// Runs every 15 minutes from pg_cron; also kicked once right after subscribe.
// ICS has no delta protocol, so each run pulls the full feed, upserts every
// event in the window, then deletes anything not seen this run (handles
// cancellations and feeds that drop past events).
import { admin, handleOptions, json, logSync, readSecret } from "../_shared/admin.ts";
import { type IcsAccount, parseIcs } from "../_shared/ics.ts";
import { reconcileEvents } from "../_shared/eventSync.ts";
import { loadAccountsPaged, markSyncResult } from "../_shared/syncSchedule.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;

async function syncAccount(account: IcsAccount): Promise<void> {
  const fail = async (why: string) => {
    await admin.from("calendar_accounts").update({ needs_reconnect: true }).eq("id", account.id);
    throw new Error(why);
  };

  if (!account.refresh_token_secret_id) return await fail("no feed url stored");
  const feedUrl = await readSecret(account.refresh_token_secret_id);
  if (!feedUrl) return await fail("feed url missing from vault");

  const res = await fetch(feedUrl, { headers: { Accept: "text/calendar" } });
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

  // Write only what actually changed and delete only what the feed stopped
  // sending. A feed that hasn't changed since the last poll costs zero writes —
  // which is the whole point, because this runs every 15 minutes forever and
  // the old unconditional upsert rewrote every row every time. Deduping and
  // chunking now live in reconcileEvents.
  const { written, deleted, unchanged } = await reconcileEvents(
    { accountId: account.id },
    rows,
    { sweep: true },
  );
  if (written || deleted) {
    await logSync(
      "ics",
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
    const accounts = (await loadAccountsPaged("ics", accountId)) as IcsAccount[];

    for (const account of accounts) {
      try {
        await syncAccount(account);
        await markSyncResult(account.id, true);
        await logSync("ics", "sync", "ok", undefined, account.user_id);
      } catch (e) {
        await markSyncResult(account.id, false);
        await logSync("ics", "sync", "error", e instanceof Error ? e.message : String(e), account.user_id);
      }
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("ics", "sync", "error", msg);
    return json({ error: msg }, 500);
  }
});
