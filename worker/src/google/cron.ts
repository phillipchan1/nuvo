import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { claimDueGoogleAccounts } from "./owned.ts";
import { runGoogleSync } from "./sync.ts";
import { DISPATCH_BATCH } from "./types.ts";

/**
 * Daily channel renewal (`nuvo-google-renew` was 15 9 * * *).
 * Re-watches channels that expire within 48h. Poll fallback is calendar-dispatch.
 */
export async function runGoogleRenew(sql: Sql, env: Env, reqUrl?: string) {
  return runGoogleSync(sql, env, { mode: "renew-channels", reqUrl });
}

/**
 * Cutover flip: re-subscribe every Google watch channel to the Worker webhook.
 * Watch setup can fail (unverified domain); calendar-dispatch poll still covers those.
 */
export async function runGoogleResubscribe(sql: Sql, env: Env, reqUrl?: string) {
  return runGoogleSync(sql, env, { mode: "resubscribe", reqUrl });
}

/**
 * Per-minute dispatcher. Claims due Google accounts and runs poll (stale calendars
 * only). Other providers stay on Supabase until PR C.
 *
 * Projection: DISPATCH_BATCH=50/min. A stale incremental is usually an empty
 * sync-token delta. Past ~200 due Google accounts/min, fan-out should move to
 * Cloudflare Queues (Workers Paid included ops — no extra spend). Cron CPU on
 * Paid is 15 min wall; 50 × ~2s worst-case stays inside that.
 */
export async function runCalendarDispatch(sql: Sql, env: Env, reqUrl?: string) {
  const claimed = await claimDueGoogleAccounts(sql, DISPATCH_BATCH);
  let ran = 0;
  const failures: string[] = [];
  for (const row of claimed) {
    try {
      await runGoogleSync(sql, env, {
        mode: "poll",
        accountId: row.id,
        userId: row.user_id,
        reqUrl,
      });
      ran++;
    } catch {
      failures.push(row.id);
    }
  }
  return { ok: true, claimed: claimed.length, ran, failures: failures.length };
}

export const GOOGLE_CRON_JOBS = ["google-renew", "calendar-dispatch", "google-resubscribe"] as const;
export type GoogleCronJob = (typeof GOOGLE_CRON_JOBS)[number];

export function isGoogleCronJob(name: string): name is GoogleCronJob {
  return (GOOGLE_CRON_JOBS as readonly string[]).includes(name);
}

export async function runGoogleCronJob(
  sql: Sql,
  env: Env,
  job: GoogleCronJob,
  reqUrl?: string,
) {
  if (job === "google-renew") return runGoogleRenew(sql, env, reqUrl);
  if (job === "google-resubscribe") return runGoogleResubscribe(sql, env, reqUrl);
  return runCalendarDispatch(sql, env, reqUrl);
}
