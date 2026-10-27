/**
 * Single fail-closed flip gate for Worker crons and CRON_SECRET routes.
 *
 * Do not import writeFrozen / maintenance.ts — a freeze typo must not
 * start these jobs, and a flip typo must not unfreeze writes.
 */
import { OPEN_CORS, json } from "./cors.ts";
import type { Env } from "./env.ts";

export type FlipEnv = Pick<Env, "CUTOVER_FLIPPED">;

/** Allowlist only. Unset, empty, non-strings, and anything else is not flipped. */
export function cutoverFlipped(value: unknown): boolean {
  const v = (typeof value === "string" ? value : "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Worker copies of jobs that must not run beside Supabase `pg_cron`.
 * Includes every name the cron dispatcher can fire, plus the queue
 * consumer and jobs later PRs add (google-resubscribe).
 */
export const POST_FLIP_CRON_JOBS: readonly string[] = [
  "github-poll",
  "trim-sync-log",
  "calendar-dispatch",
  "google-renew",
  "google-resubscribe",
  "push-dispatch",
  "rollover",
  "purge-trash",
  "reminder-deliveries-prune",
  "queue-consume",
];

export const CUTOVER_NOT_FLIPPED = "cutover_not_flipped";

export interface CutoverSkip {
  ok: true;
  skipped: true;
  reason: typeof CUTOVER_NOT_FLIPPED;
  job: string;
}

/** The one skip payload. HTTP and runCronJob both return this object. */
export function cutoverSkipBody(job: string): CutoverSkip {
  return { ok: true, skipped: true, reason: CUTOVER_NOT_FLIPPED, job };
}

/** HTTP 200 skip. The one shape both cron paths and bearer routes return. */
export function skippedUntilCutoverFlip(job: string): Response {
  return json(cutoverSkipBody(job), 200, OPEN_CORS);
}

/** null = run. Otherwise the skip Response. Used by handleCron + runCronJob. */
export function gateCron(env: FlipEnv, job: string): Response | null {
  if (cutoverFlipped(env.CUTOVER_FLIPPED)) return null;
  return skippedUntilCutoverFlip(job);
}

/**
 * Same skip, for every HTTP route that accepts the CRON_SECRET bearer
 * to do sync or cron-like work. Check before the DB opens.
 */
export function gateCronBearerRoute(env: FlipEnv, name: string): Response | null {
  return gateCron(env, name);
}
