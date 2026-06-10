// Microsoft 365 read-only sync via Graph calendarView delta queries.
// Runs every 5 minutes from pg_cron; also kicked once right after connect.
import { admin, handleOptions, json, logSync } from "../_shared/admin.ts";
import { GRAPH, type MsAccount, getMsAccessToken } from "../_shared/ms.ts";

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

    const upserts = [];
    const deletes: string[] = [];
    for (const e of body.value ?? []) {
      if (e["@removed"]) {
        deletes.push(e.id);
        continue;
      }
      const row = mapGraphEvent(account, e);
      if (row) upserts.push(row);
    }
    if (upserts.length) {
      const { error } = await admin
        .from("external_events")
        .upsert(upserts, { onConflict: "account_id,calendar_id,provider_event_id" });
      if (error) throw error;
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
    let q = admin.from("calendar_accounts").select("*").eq("provider", "m365");
    if (accountId) q = q.eq("id", accountId);
    const { data: accounts, error } = await q;
    if (error) throw error;

    for (const account of (accounts ?? []) as MsAccount[]) {
      if (account.needs_reconnect && !accountId) continue;
      try {
        await syncAccount(account);
        await logSync("m365", "delta-sync", "ok", undefined, account.user_id);
      } catch (e) {
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
