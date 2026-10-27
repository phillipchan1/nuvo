import type { Env } from "../env.ts";
import { logServerError } from "../lib/redact.ts";
import { listOwnedGoogleAccounts, makeCalendarStore } from "./owned.ts";
import { runGoogleContacts } from "./contacts.ts";
import { runGoogleSync } from "./sync.ts";
import type { Sql } from "../db.ts";

export async function runCalendarRefreshGoogle(
  sql: Sql,
  env: Env,
  userId: string,
  fullSync: boolean,
  reqUrl?: string,
): Promise<{ ok: true; synced: number; errors?: string[] }> {
  const store = makeCalendarStore(sql, userId);
  const accounts = (await listOwnedGoogleAccounts(store)).filter((a) => !a.needs_reconnect);
  const errors: string[] = [];
  let synced = 0;
  for (const account of accounts) {
    try {
      await runGoogleSync(sql, env, {
        mode: fullSync ? "full" : "incremental",
        accountId: account.id,
        userId,
        reqUrl,
      });
      synced++;
    } catch (e) {
      logServerError("calendar-refresh", e);
      errors.push("google: sync failed");
    }
    await runGoogleContacts(sql, env, { accountId: account.id, userId }).catch(() => undefined);
  }
  if (errors.length === accounts.length && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return { ok: true, synced, errors: errors.length ? errors : undefined };
}
