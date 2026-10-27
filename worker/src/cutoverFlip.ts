/**
 * Post-flip gate for Worker copies of jobs that stay on Supabase `pg_cron`
 * until the switch. One flag, fail closed. B/D add names to
 * `POST_FLIP_CRON_JOBS` — do not invent a second flag.
 *
 * A later PR owns this file as the only implementation. Names here
 * (`cutoverFlipped`, `POST_FLIP_CRON_JOBS`, `skippedUntilCutoverFlip`,
 * `gateCron`, `gateCronBearerRoute`) stay stable for that swap.
 */
export const CUTOVER_FLIPPED_VALUES = ["1", "true", "yes", "on"] as const;

export function cutoverFlipped(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return (CUTOVER_FLIPPED_VALUES as readonly string[]).includes(v);
}

export const POST_FLIP_CRON_JOBS = ["github-poll", "trim-sync-log"] as const;
export type PostFlipCronJob = (typeof POST_FLIP_CRON_JOBS)[number];

const POST_FLIP_ALIASES: Record<string, PostFlipCronJob> = {
  "nuvo-github-poll": "github-poll",
  "nuvo-trim-sync-log": "trim-sync-log",
};

export interface CutoverFlipEnv {
  CUTOVER_FLIPPED?: string;
}

export interface CutoverFlipSkip {
  job: string;
  status: 200;
  stay_on_supabase: true;
  skipped: true;
  reason: "cutover_not_flipped";
}

export function asPostFlipJob(job: string): PostFlipCronJob | null {
  const raw = job.trim().toLowerCase();
  if ((POST_FLIP_CRON_JOBS as readonly string[]).includes(raw)) return raw as PostFlipCronJob;
  return POST_FLIP_ALIASES[raw] ?? null;
}

/** Fail closed: unset / unknown `CUTOVER_FLIPPED` = not flipped. */
export function skipUntilCutoverFlip(job: string, env: CutoverFlipEnv): boolean {
  return asPostFlipJob(job) != null && !cutoverFlipped(env.CUTOVER_FLIPPED);
}

export function skippedUntilCutoverFlip(job: string, env: CutoverFlipEnv): CutoverFlipSkip | null {
  const name = asPostFlipJob(job);
  if (!name || cutoverFlipped(env.CUTOVER_FLIPPED)) return null;
  return {
    job: name,
    status: 200,
    stay_on_supabase: true,
    skipped: true,
    reason: "cutover_not_flipped",
  };
}

/** Scheduled / `runCronJob` gate. Null means run the job. */
export function gateCron(job: string, env: CutoverFlipEnv): CutoverFlipSkip | null {
  return skippedUntilCutoverFlip(job, env);
}

/**
 * CRON_SECRET bearer routes (github-activity `action: "sync"`, later B/D).
 * Call before opening the DB.
 */
export function gateCronBearerRoute(job: string, env: CutoverFlipEnv): CutoverFlipSkip | null {
  return skippedUntilCutoverFlip(job, env);
}
