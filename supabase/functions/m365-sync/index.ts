// Microsoft 365 read-only sync via Graph calendarView delta queries.
// Runs every 5 minutes from pg_cron; also kicked once right after connect.
import { admin, handleOptions, json, logSync } from "../_shared/admin.ts";
import { GRAPH, type MsAccount, getMsAccessToken } from "../_shared/ms.ts";
import { type EventRow, reconcileEvents } from "../_shared/eventSync.ts";
import { loadAccountsPaged, markSyncResult } from "../_shared/syncSchedule.ts";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 120;

// deno-lint-ignore no-explicit-any
function mapGraphEvent(account: MsAccount, e: any) {
  if (!e.start?.dateTime || !e.end?.dateTime) return null;
  return {
    user_id: account.user_id,
    account_id: account.id,
    provider_event_id: e.id as string,
    calendar_id: "primary",
    title: (e.subject as string) || "(no title)",
    // Graph delta returns UTC dateTimes (no offset suffix) — append Z
    start_at: e.start.dateTime.endsWith("Z") ? e.start.dateTime : `${e.start.dateTime}Z`,
    end_at: e.end.dateTime.endsWith("Z") ? e.end.dateTime : `${e.end.dateTime}Z`,
    all_day: Boolean(e.isAllDay),
    location: (e.location?.displayName as string) || null,
    busy: e.showAs !== "free",
    raw: e,
    last_synced_at: new Date().toISOString(),
  };
}

async function syncAccount(account: MsAccount): Promise<void> {
  const token = await getMsAccessToken(account);

  let url = account.delta_link;
  if (!url) {
    const start = new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000).toISOString();
    const end = new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000).toISOString();
    url = `${GRAPH}/me/calendarView/delta?startDateTime=${start}&endDateTime=${end}`;
    // New baseline — drop the old mirror so removed events don't linger
    await admin.from("external_events").delete().eq("account_id", account.id);
  }

  let deltaLink: string | null = null;
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 410) {
      // Delta token expired: reset and let the next run rebuild the baseline
      await admin.from("calendar_accounts").update({ delta_link: null }).eq("id", account.id);
      throw new Error("delta link expired; baseline reset");
    }
    if (!res.ok) throw new Error(`calendarView delta: ${res.status} ${await res.text()}`);
    const body = await res.json();

    const upserts: EventRow[] = [];
    const deletes: string[] = [];
    for (const e of body.value ?? []) {
      if (e["@removed"]) {
        deletes.push(e.id);
        continue;
      }
      const row = mapGraphEvent(account, e);
      if (row) upserts.push(row);
    }
    // Graph delta already tells us what changed, but it re-sends an event for
    // any touch — including ones that leave every field we store identical.
    // Reconciling turns those back into no writes, so a quiet mailbox produces
    // no WAL and no Realtime fan-out. No sweep: removals arrive as @removed
    // tombstones, and absence from a delta page means "unchanged", not "gone".
    if (upserts.length) {
      await reconcileEvents({ accountId: account.id, calendarId: "primary" }, upserts, {
        sweep: false,
      });
    }
    if (deletes.length) {
      await admin
        .from("external_events")
        .delete()
        .eq("account_id", account.id)
        .in("provider_event_id", deletes);
    }

    url = body["@odata.nextLink"] ?? null;
    deltaLink = body["@odata.deltaLink"] ?? deltaLink;
  }

  if (deltaLink) {
    await admin.from("calendar_accounts").update({ delta_link: deltaLink }).eq("id", account.id);
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
    const accounts = (await loadAccountsPaged("m365", accountId)) as MsAccount[];

    for (const account of accounts) {
      if (account.needs_reconnect && !accountId) continue;
      try {
        await syncAccount(account);
        await markSyncResult(account.id, true);
        await logSync("m365", "delta-sync", "ok", undefined, account.user_id);
      } catch (e) {
        await markSyncResult(account.id, false);
        await logSync(
          "m365",
          "delta-sync",
          "error",
          e instanceof Error ? e.message : String(e),
          account.user_id,
        );
      }
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("m365", "sync", "error", msg);
    return json({ error: msg }, 500);
  }
});
