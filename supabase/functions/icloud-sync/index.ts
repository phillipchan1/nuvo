// Read sync for iCloud (Apple Calendar) accounts over CalDAV.
// Runs every 15 minutes from pg_cron; also kicked right after connect and by
// calendar-refresh. CalDAV has no cheap delta, so each run re-queries the window
// per calendar, upserts every event, then sweeps anything not seen this run
// (handles cancellations / deletions upstream).
import { admin, handleOptions, json, logSync, readSecret } from "../_shared/admin.ts";
import { type ExternalEventRow, parseIcs } from "../_shared/ics.ts";
import { discoverCalendars, fetchEvents } from "../_shared/caldav.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;
const CHUNK = 500;

interface IcloudAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token_secret_id: string | null;
  needs_reconnect: boolean;
  // deno-lint-ignore no-explicit-any
  calendars: any[] | null;
}

async function syncAccount(account: IcloudAccount): Promise<void> {
  const fail = async (why: string) => {
    await admin.from("calendar_accounts").update({ needs_reconnect: true }).eq("id", account.id);
    throw new Error(why);
  };

  if (!account.refresh_token_secret_id) return await fail("no app-specific password stored");
  const password = await readSecret(account.refresh_token_secret_id);
  if (!password) return await fail("app-specific password missing from vault");

  const username = account.email;
  const windowStart = new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000);
  const windowEnd = new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000);
  const runStamp = new Date().toISOString();

  // Re-discover so new/renamed calendars are picked up between polls.
  let calendars;
  try {
    calendars = await discoverCalendars(username, password);
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }

  // Refresh the stored calendars list when discovery changed (keeps colors/names
  // current and surfaces newly-created calendars in Settings).
  const nextCals = calendars.map((c) => ({ id: c.url, summary: c.displayName, color: c.color, visible: true }));
  if (JSON.stringify(nextCals) !== JSON.stringify(account.calendars ?? [])) {
    await admin.from("calendar_accounts").update({ calendars: nextCals }).eq("id", account.id);
  }

  for (const cal of calendars) {
    const events = await fetchEvents(cal.url, username, password, windowStart, windowEnd);
    const rows: ExternalEventRow[] = [];
    for (const ev of events) {
      const { rows: parsed } = parseIcs(ev.ics, {
        userId: account.user_id,
        accountId: account.id,
        windowStart,
        windowEnd,
        runStamp,
        calendarId: cal.url,
      });
      for (const row of parsed) {
        row.raw = { caldav_href: ev.href, caldav_etag: ev.etag };
        rows.push(row);
      }
    }

    // Dedupe on the upsert key — a repeated UID across resources would otherwise
    // make a single upsert batch touch a row twice and fail the run.
    const deduped = [...new Map(rows.map((r) => [r.provider_event_id, r])).values()];

    for (let i = 0; i < deduped.length; i += CHUNK) {
      const { error } = await admin
        .from("external_events")
        .upsert(deduped.slice(i, i + CHUNK), { onConflict: "account_id,calendar_id,provider_event_id" });
      if (error) throw error;
    }
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
    let q = admin.from("calendar_accounts").select("*").eq("provider", "icloud");
    if (accountId) q = q.eq("id", accountId);
    const { data: accounts, error } = await q;
    if (error) throw error;

    for (const account of (accounts ?? []) as IcloudAccount[]) {
      try {
        await syncAccount(account);
        await logSync("icloud", "sync", "ok", undefined, account.user_id);
      } catch (e) {
        await logSync("icloud", "sync", "error", e instanceof Error ? e.message : String(e), account.user_id);
      }
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("icloud", "sync", "error", msg);
    return json({ error: msg }, 500);
  }
});
