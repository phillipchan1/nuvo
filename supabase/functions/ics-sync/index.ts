// Read-only sync for subscribed iCalendar (.ics) feeds.
// Runs every 15 minutes from pg_cron; also kicked once right after subscribe.
// ICS has no delta protocol, so each run pulls the full feed, upserts every
// event in the window, then deletes anything not seen this run (handles
// cancellations and feeds that drop past events).
import { admin, handleOptions, json, logSync, readSecret } from "../_shared/admin.ts";
import { type IcsAccount, parseIcs } from "../_shared/ics.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;
const CHUNK = 500;

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
  });

  // Dedupe on the upsert key — a repeated UID in the feed would otherwise make
  // a single upsert batch "affect a row a second time" and fail the run.
  const deduped = [...new Map(rows.map((r) => [r.provider_event_id, r])).values()];

  for (let i = 0; i < deduped.length; i += CHUNK) {
    const { error } = await admin
      .from("external_events")
      .upsert(deduped.slice(i, i + CHUNK), { onConflict: "account_id,calendar_id,provider_event_id" });
    if (error) throw error;
  }

  // Sweep anything not refreshed this run (removed/cancelled upstream).
  await admin
    .from("external_events")
    .delete()
    .eq("account_id", account.id)
    .lt("last_synced_at", runStamp);

  if (account.needs_reconnect) {
    await admin.from("calendar_accounts").update({ needs_reconnect: false }).eq("id", account.id);
  }
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const { accountId } = await req.json().catch(() => ({}));

  try {
    let q = admin.from("calendar_accounts").select("*").eq("provider", "ics");
    if (accountId) q = q.eq("id", accountId);
    const { data: accounts, error } = await q;
    if (error) throw error;

    for (const account of (accounts ?? []) as IcsAccount[]) {
      try {
        await syncAccount(account);
        await logSync("ics", "sync", "ok", undefined, account.user_id);
      } catch (e) {
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
