/**
 * M365 / iCloud / ICS poll. Worker cron trigger or `/api/cron/:job`.
 *
 * Fan-out: batched loop in this isolate (Workers Paid CPU). A later Queue
 * (still Workers Paid included ops) can replace the loop if a tick exceeds
 * CPU budget — flagged, not built here.
 */
import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { claimDueAccounts } from "./store.ts";
import { runIcloudContacts, runIcloudSync } from "./icloud.ts";
import { runIcsSync } from "./icsFeed.ts";
import { runM365Sync } from "./m365.ts";

export const CALENDAR_CRON_PROVIDERS = ["m365", "icloud", "ics"] as const;

const CALENDAR_CRON_JOBS = new Set([
  "m365-sync",
  "nuvo-m365-poll",
  "icloud-sync",
  "nuvo-icloud-poll",
  "ics-sync",
  "nuvo-ics-poll",
  "calendar-dispatch",
  "nuvo-calendar-dispatch",
]);

export function isCalendarCronJob(job: string): boolean {
  return CALENDAR_CRON_JOBS.has(job);
}

export async function runCalendarDispatch(sql: Sql, env: Env): Promise<{ ok: true; claimed: number }> {
  const due = await claimDueAccounts(sql, [...CALENDAR_CRON_PROVIDERS], 50);
  for (const account of due) {
    if (account.provider === "m365") await runM365Sync(sql, env, account.id);
    else if (account.provider === "icloud") {
      await runIcloudSync(sql, env, account.id);
      await runIcloudContacts(sql, env, account.id);
    } else if (account.provider === "ics") await runIcsSync(sql, env, account.id);
  }
  return { ok: true, claimed: due.length };
}

export async function runCalendarCron(
  sql: Sql,
  env: Env,
  job: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (job === "m365-sync" || job === "nuvo-m365-poll") {
    const out = await runM365Sync(sql, env);
    return { status: "error" in out ? 500 : 200, body: out };
  }
  if (job === "icloud-sync" || job === "nuvo-icloud-poll") {
    const out = await runIcloudSync(sql, env);
    return { status: "error" in out ? 500 : 200, body: out };
  }
  if (job === "ics-sync" || job === "nuvo-ics-poll") {
    const out = await runIcsSync(sql, env);
    return { status: "error" in out ? 500 : 200, body: out };
  }
  if (job === "calendar-dispatch" || job === "nuvo-calendar-dispatch") {
    return { status: 200, body: await runCalendarDispatch(sql, env) };
  }
  return null;
}
