// Run: node --experimental-strip-types worker/src/cutoverFlip.check.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUTOVER_NOT_FLIPPED,
  POST_FLIP_CRON_JOBS,
  cutoverFlipped,
  gateCron,
  gateCronBearerRoute,
  skippedUntilCutoverFlip,
} from "./cutoverFlip.ts";
import { PGlite } from "@electric-sql/pglite";
import { ALL_CRON_SCHEDULES, CRON_BY_SCHEDULE, canonicalCronJob, consumeCalendarSyncBatch, runCronJob } from "./cronJobs.ts";
import { installOpenSqlForTests, type Sql } from "./db.ts";
import app from "./index.ts";
import { applyIsolationSchema } from "./isolationDb.ts";
import { writeFrozen } from "./maintenance.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const flipSrc = readFileSync(join(here, "cutoverFlip.ts"), "utf8");
const cronJobsSrc = readFileSync(join(here, "cronJobs.ts"), "utf8");
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
const envSrc = readFileSync(join(here, "env.ts"), "utf8");
const googleRoutesSrc = readFileSync(join(here, "google/routes.ts"), "utf8");
const exampleSrc = readFileSync(join(here, "../../.dev.vars.example"), "utf8");

ok(!/\bwriteFrozen\s*\(/.test(flipSrc), "cutoverFlip.ts does not call writeFrozen");
ok(!/from ["']\.\/maintenance/.test(flipSrc), "cutoverFlip.ts does not import maintenance.ts");
ok(/CUTOVER_FLIPPED\?:/.test(envSrc), "Env names CUTOVER_FLIPPED");
ok(/# CUTOVER_FLIPPED=/.test(exampleSrc), ".dev.vars.example leaves CUTOVER_FLIPPED unset");

ok(cutoverFlipped("1") && cutoverFlipped("true") && cutoverFlipped("yes") && cutoverFlipped("on"), "cutoverFlipped allowlist");
ok(cutoverFlipped("TRUE") && cutoverFlipped(" Yes ") && cutoverFlipped("ON"), "cutoverFlipped is case-insensitive and trimmed");
ok(!cutoverFlipped(undefined) && !cutoverFlipped(null) && !cutoverFlipped(""), "cutoverFlipped unset/empty is not flipped");
ok(!cutoverFlipped("  "), "cutoverFlipped whitespace is not flipped");
for (const value of ["garbage", "maybe", "2", "flipped", "false", "0"]) {
  ok(!cutoverFlipped(value), `cutoverFlipped ${JSON.stringify(value)} is not flipped`);
}
for (const value of [1, true, false, 0, 2, { toString: () => "1" }, ["1"]]) {
  let threw = false;
  let flipped = true;
  try {
    flipped = cutoverFlipped(value);
  } catch {
    threw = true;
  }
  ok(!threw && flipped === false, `cutoverFlipped non-string ${typeof value} skips without throwing`);
}

const dispatched = [...new Set(Object.values(CRON_BY_SCHEDULE).flat())];
ok(dispatched.length > 0, "cron dispatcher lists at least one job");
for (const job of dispatched) {
  ok(POST_FLIP_CRON_JOBS.includes(job), `POST_FLIP_CRON_JOBS covers dispatcher job ${job}`);
}
for (const required of [
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
  "m365-sync",
  "icloud-sync",
  "ics-sync",
]) {
  ok(POST_FLIP_CRON_JOBS.includes(required), `POST_FLIP_CRON_JOBS includes ${required}`);
}

ok(/gateCron\(env, name\)/.test(cronJobsSrc), "runCronJob calls gateCron");
ok(/gateCron\(c\.env, name\)/.test(cronJobsSrc), "handleCron calls gateCron");
ok(/gateCron\(env, "queue-consume"\)/.test(cronJobsSrc), "queue consumer calls gateCron");
ok(!/false\s*&&\s*gateCron\(env, "queue-consume"\)/.test(cronJobsSrc), "queue consumer gate is not short-circuited");
ok(!/catch \{\s*continue;\s*\}/.test(cronJobsSrc), "queue consumer does not continue without ack or retry");
ok(/acks\. Retry only when SQL cannot open/.test(cronJobsSrc), "queue consumer documents ack after runGoogleSync (per-account errors already back off)");
ok(/gateCronBearerRoute\(c\.env, "google-sync"\)/.test(googleRoutesSrc), "google-sync cron bearer uses gateCronBearerRoute");
ok(/gateCronBearerRoute\(c\.env, "google-contacts"\)/.test(googleRoutesSrc), "google-contacts cron bearer uses gateCronBearerRoute");
ok(/gateCronBearerRoute\(c\.env, "google-events"\)/.test(googleRoutesSrc), "google-events cron bearer uses gateCronBearerRoute");
const syncWrite = (() => {
  const chunk = googleRoutesSrc.slice(googleRoutesSrc.indexOf('paths("google-sync")'), googleRoutesSrc.indexOf('paths("google-events")'));
  return chunk.slice(chunk.indexOf("freezeWrite"));
})();
const eventsWrite = (() => {
  const chunk = googleRoutesSrc.slice(googleRoutesSrc.indexOf('paths("google-events")'), googleRoutesSrc.indexOf('paths("google-webhook")'));
  return chunk.slice(chunk.indexOf("freezeWrite"));
})();
const contactsWrite = (() => {
  const chunk = googleRoutesSrc.slice(googleRoutesSrc.indexOf('paths("google-contacts")'), googleRoutesSrc.indexOf('paths("calendar-refresh")'));
  return chunk.slice(chunk.indexOf("freezeWrite"));
})();
ok(syncWrite.indexOf("gateCronBearerRoute") >= 0 && syncWrite.indexOf("gateCronBearerRoute") < syncWrite.indexOf("requestIo"), "google-sync gates before requestIo");
ok(eventsWrite.indexOf("gateCronBearerRoute") >= 0 && eventsWrite.indexOf("gateCronBearerRoute") < eventsWrite.indexOf("requestIo"), "google-events gates before requestIo");
ok(contactsWrite.indexOf("gateCronBearerRoute") >= 0 && contactsWrite.indexOf("gateCronBearerRoute") < contactsWrite.indexOf("requestIo"), "google-contacts gates before requestIo");
ok(/cronOk && acting/.test(eventsWrite) && eventsWrite.includes('gateCronBearerRoute(c.env, "google-events")'), "google-events gates the cronOk && acting branch");
const runIdx = cronJobsSrc.indexOf("export async function runCronJob");
const runGate = cronJobsSrc.indexOf("gateCron(env, name)", runIdx);
const runSql = cronJobsSrc.indexOf("enqueueDueCalendarAccounts", runIdx);
ok(runGate > runIdx && runGate < runSql, "runCronJob gates before any DB or queue work");
const httpIdx = cronJobsSrc.indexOf("export async function handleCron");
const httpGate = cronJobsSrc.indexOf("gateCron(c.env, name)", httpIdx);
const httpIo = cronJobsSrc.indexOf("requestIo(c)", httpIdx);
ok(httpGate > httpIdx && httpGate < httpIo, "handleCron gates before requestIo");
ok(/cutoverFlipped\(env\.CUTOVER_FLIPPED\)/.test(indexSrc), "scheduled path checks the flip before openSql");
ok(indexSrc.indexOf("if (cutoverFlipped(env.CUTOVER_FLIPPED))") < indexSrc.indexOf("sql = openSql(env)"), "scheduled opens SQL only after flip");

const scheduledFn = (
  app as typeof app & {
    scheduled(
      event: { cron: string },
      env: Record<string, string | undefined>,
      ctx: { waitUntil(promise: Promise<unknown>): void },
    ): Promise<void>;
  }
).scheduled;
ok(typeof scheduledFn === "function", "app exports scheduled");
let scheduledSqlOpens = 0;
const restoreOpenSql = installOpenSqlForTests(() => {
  scheduledSqlOpens += 1;
  throw new Error("openSql used before flip");
});
try {
  for (const cron of ALL_CRON_SCHEDULES) {
    await scheduledFn({ cron }, {}, { waitUntil() {} });
    await scheduledFn({ cron }, { CUTOVER_FLIPPED: "garbage" }, { waitUntil() {} });
  }
  ok(scheduledSqlOpens === 0, "unflipped scheduled() opens no SQL for every cron");
} finally {
  restoreOpenSql();
}

const ghSrc = readFileSync(join(here, "githubActivity.ts"), "utf8");
ok(
  /gateCronBearerRoute\(\s*c\.env\s*,\s*["']github-poll["']\s*\)/.test(ghSrc),
  "github-activity CRON_SECRET sync calls gateCronBearerRoute(c.env, 'github-poll')",
);
const ghSyncAt = ghSrc.indexOf('action === "sync" && cronAuthorized');
const ghIoAt = ghSrc.indexOf("requestIo(c)", ghSyncAt);
const ghGateAt = ghSrc.search(/gateCronBearerRoute\(\s*c\.env\s*,\s*["']github-poll["']\s*\)/);
ok(ghSyncAt >= 0 && ghGateAt > ghSyncAt && ghGateAt < ghIoAt, "github-activity CRON_SECRET sync gates before requestIo");

function walkProdTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkProdTs(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".check.ts")) out.push(p);
  }
  return out;
}

function sliceBlock(src: string, start: number, name: string, out: { name: string; body: string }[]) {
  const brace = src.indexOf("{", start);
  if (brace < 0) return;
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        out.push({ name, body: src.slice(start, i + 1) });
        return;
      }
    }
  }
}

function functionsIn(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) sliceBlock(src, m.index, m[1], out);
  const arrowRe = /(?:async\s+)?\([^)]*\)\s*=>\s*\{/g;
  let a: RegExpExecArray | null;
  while ((a = arrowRe.exec(src))) sliceBlock(src, a.index, "(arrow)", out);
  return out;
}

function usesCronSecretAuth(body: string): boolean {
  if (/\bcronAuthorized\s*\(/.test(body)) return true;
  if (/CRON_SECRET/.test(body) && /\bbearerToken\s*\(/.test(body)) return true;
  if (/x-cron-secret/i.test(body)) return true;
  if (/Bearer\s*\$\{[^}]*CRON_SECRET/.test(body)) return true;
  if (/(?:===|!==|==|!=)\s*(?:c\.)?env\.CRON_SECRET/.test(body)) return true;
  if (/(?:c\.)?env\.CRON_SECRET\s*(?:===|!==|==|!=)/.test(body)) return true;
  return false;
}

function isFlipGated(body: string): boolean {
  return /\bgateCron\s*\(/.test(body) || /\bgateCronBearerRoute\s*\(/.test(body);
}

function hasInlineCronCompare(src: string): boolean {
  return (
    /x-cron-secret/i.test(src) ||
    /Bearer\s*\$\{[^}]*CRON_SECRET/.test(src) ||
    /["']Bearer ["']\s*\+\s*[^\n]*CRON_SECRET/.test(src) ||
    /(?:===|!==|==|!=)\s*(?:c\.)?env\.CRON_SECRET/.test(src) ||
    /(?:c\.)?env\.CRON_SECRET\s*(?:===|!==|==|!=)/.test(src)
  );
}

let cronSecretFns = 0;
for (const file of walkProdTs(here)) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(here.length + 1);
  if (rel === "cron.ts") continue;
  ok(!hasInlineCronCompare(src), `${rel}: no inline Bearer / x-cron-secret compare outside cron.ts`);
  for (const fn of functionsIn(src)) {
    if (!usesCronSecretAuth(fn.body)) continue;
    cronSecretFns += 1;
    ok(
      isFlipGated(fn.body),
      `${rel} ${fn.name}: cronAuthorized / CRON_SECRET-bearer caller is gated by gateCron or gateCronBearerRoute`,
    );
  }
}
ok(cronSecretFns >= 2, "per-function CRON_SECRET scan found handleCron and github-activity");

const calendarHttpSrc = readFileSync(join(here, "calendar/http.ts"), "utf8");
ok(/const BEARER_SYNC = \["m365-sync", "icloud-sync", "icloud-contacts", "ics-sync"\]/.test(calendarHttpSrc), "calendar bearer sync list is m365/icloud/ics");
for (const name of ["m365-sync", "icloud-sync", "icloud-contacts", "ics-sync"] as const) {
  ok(calendarHttpSrc.includes(`"${name}"`), `calendar BEARER_SYNC includes ${name}`);
}
ok(/gateCronBearerRoute\(c\.env, name\)/.test(calendarHttpSrc), "calendar bearer sync uses gateCronBearerRoute(c.env, name)");
const bearerSyncFn = functionsIn(calendarHttpSrc).find((fn) => fn.name === "handleBearerSync");
ok(Boolean(bearerSyncFn), "handleBearerSync is the calendar cron-bearer function");
if (bearerSyncFn) {
  ok(isFlipGated(bearerSyncFn.body), "handleBearerSync is flip-gated");
  ok(
    bearerSyncFn.body.indexOf("gateCronBearerRoute") >= 0 &&
      bearerSyncFn.body.indexOf("gateCronBearerRoute") < bearerSyncFn.body.indexOf("requestIo"),
    "handleBearerSync gates before requestIo",
  );
}

function proveGateMutation(path: string, mutate: (src: string) => string, stillGreen: (src: string) => boolean, label: string): void {
  const orig = readFileSync(path, "utf8");
  try {
    const next = mutate(orig);
    ok(next !== orig, `${label}: mutation changed the file`);
    writeFileSync(path, next);
    ok(!stillGreen(readFileSync(path, "utf8")), `${label}: removing the gate fails the scan`);
  } finally {
    writeFileSync(path, orig);
  }
}

proveGateMutation(
  join(here, "calendar/http.ts"),
  (src) => src.replace("gateCronBearerRoute(c.env, name)", "null"),
  (src) => {
    const fn = functionsIn(src).find((f) => f.name === "handleBearerSync");
    return Boolean(fn && isFlipGated(fn.body));
  },
  "gateCronBearerRoute mutation",
);
proveGateMutation(
  join(here, "cronJobs.ts"),
  (src) => src.replace("if (gateCron(env, name))", "if (false)"),
  (src) => /gateCron\(env, name\)/.test(src),
  "gateCron mutation",
);

const consumeStart = cronJobsSrc.search(/export async function consumeCalendarSyncBatch/);
ok(consumeStart >= 0, "queue consumer is consumeCalendarSyncBatch");
const consumeNext = cronJobsSrc.indexOf("\nexport ", consumeStart + 1);
const consumeFn = cronJobsSrc.slice(consumeStart, consumeNext === -1 ? undefined : consumeNext);
const unflippedGate = consumeFn.search(/if\s*\(\s*gateCron\(\s*env\s*,\s*["']queue-consume["']\s*\)\s*\)/);
ok(unflippedGate >= 0, "queue consumer gates on gateCron(env, 'queue-consume') (M11)");
const unflippedBrace = consumeFn.indexOf("{", unflippedGate);
let unflippedDepth = 0;
let unflippedEnd = -1;
for (let i = unflippedBrace; i < consumeFn.length; i++) {
  if (consumeFn[i] === "{") unflippedDepth++;
  else if (consumeFn[i] === "}") {
    unflippedDepth--;
    if (unflippedDepth === 0) {
      unflippedEnd = i;
      break;
    }
  }
}
const unflippedBlock = unflippedEnd > 0 ? consumeFn.slice(unflippedGate, unflippedEnd + 1) : "";
ok(/return\s+\w+/.test(unflippedBlock), "queue consumer returns without work when unflipped");
ok(
  !/\b(?:openSql|requestIo|fetch|runGoogleSync|runM365Sync|runIcloudSync|runIcsSync)\s*\(/.test(unflippedBlock),
  "queue consumer unflipped path does no IO",
);

const skipRes = skippedUntilCutoverFlip("rollover");
ok(skipRes.status === 200, "skippedUntilCutoverFlip is HTTP 200");
const skipBody = (await skipRes.json()) as { ok?: boolean; skipped?: boolean; reason?: string; job?: string };
ok(skipBody.ok === true && skipBody.skipped === true && skipBody.reason === CUTOVER_NOT_FLIPPED && skipBody.job === "rollover", "skippedUntilCutoverFlip body");

ok(gateCron({}, "rollover") instanceof Response, "gateCron skips when unset");
ok(gateCron({ CUTOVER_FLIPPED: "garbage" }, "push-dispatch") instanceof Response, "gateCron skips unknown value");
ok(gateCron({ CUTOVER_FLIPPED: "1" }, "rollover") === null, "gateCron null when flipped");
ok(gateCronBearerRoute({ CUTOVER_FLIPPED: "maybe" }, "github-activity") instanceof Response, "gateCronBearerRoute skips unknown value");
ok(gateCronBearerRoute({ CUTOVER_FLIPPED: "yes" }, "github-activity") === null, "gateCronBearerRoute null when flipped");

function throwingSql(): Sql {
  const trap = (): never => {
    throw new Error("sql used before flip");
  };
  return new Proxy(trap, { apply: trap, get: trap }) as unknown as Sql;
}

function throwingFetch(): typeof fetch {
  return (() => {
    throw new Error("fetch used before flip");
  }) as unknown as typeof fetch;
}

const unknownFlip = ["", "garbage", "maybe", "2", "flipped", "false", "0"] as const;
const flipOn = ["1", "true", "yes", "on"] as const;
const cronSecret = "cutover-flip-cron-secret";
const origFetch = globalThis.fetch;

let ioOpened = 0;
const restoreIo = installRequestIoForTests(() => {
  ioOpened += 1;
  throw new Error("requestIo opened before flip");
});

try {
  globalThis.fetch = throwingFetch();

  for (const job of POST_FLIP_CRON_JOBS) {
    const scheduled = await runCronJob(job, {}, throwingSql());
    ok(
      scheduled.status === 200 &&
        scheduled.ok === true &&
        scheduled.skipped === true &&
        scheduled.reason === CUTOVER_NOT_FLIPPED &&
        scheduled.job === job &&
        !("stay_on_supabase" in scheduled),
      `runCronJob ${job} skips when unset`,
    );

    for (const value of unknownFlip) {
      const out = await runCronJob(job, { CUTOVER_FLIPPED: value }, throwingSql());
      ok(out.skipped === true && out.status === 200, `runCronJob ${job} skips ${JSON.stringify(value)}`);
    }

    if (job === "queue-consume") continue;

    const httpUnset = await app.request(`http://localhost/api/cron/${job}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}` },
    }, { CRON_SECRET: cronSecret });
    ok(httpUnset.status === 200, `handleCron ${job} unset: HTTP ${httpUnset.status}`);
    const unsetBody = (await httpUnset.json()) as { ok?: boolean; skipped?: boolean; reason?: string; job?: string };
    ok(
      unsetBody.ok === true && unsetBody.skipped === true && unsetBody.reason === CUTOVER_NOT_FLIPPED && unsetBody.job === canonicalCronJob(job),
      `handleCron ${job} unset skip body`,
    );

    for (const value of unknownFlip) {
      const http = await app.request(`http://localhost/api/cron/${job}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      }, { CRON_SECRET: cronSecret, CUTOVER_FLIPPED: value });
      ok(http.status === 200, `handleCron ${job} ${JSON.stringify(value)}: HTTP ${http.status}`);
      const body = (await http.json()) as { skipped?: boolean; reason?: string };
      ok(body.skipped === true && body.reason === CUTOVER_NOT_FLIPPED, `handleCron ${job} ${JSON.stringify(value)} skip body`);
    }
  }
  ok(ioOpened === 0, "HTTP skip never opened the DB");

  let acked = 0;
  let retried = 0;
  let queueIo = 0;
  const consumed = await consumeCalendarSyncBatch(
    {
      messages: [
        { body: { account_id: "x", user_id: "y", provider: "google" }, ack: () => { acked += 1; }, retry: () => { retried += 1; } },
      ],
    },
    {
      HYPERDRIVE: {
        get connectionString() {
          queueIo += 1;
          return "postgres://probe.invalid/nuvo";
        },
      },
    },
  );
  ok(consumed === 1 && acked === 1 && retried === 0, "queue consumer acks when not flipped");
  ok(queueIo === 0, "queue consumer before flip does no IO (false && gateCron would open SQL)");
} finally {
  globalThis.fetch = origFetch;
}

{
  // Per-account Google errors (503 / missing refresh) are isolated inside
  // runGoogleSync and ack; next_sync_at backoff is the retry. Queue retry
  // would fight that. Missing refresh on the isolation seed is the same
  // path as a Google 503 after markSyncResult(false).
  const db = new PGlite();
  await applyIsolationSchema(db);
  const sql = makePgliteSql(db);
  const ACCOUNT = "aaaaaaaa-eeee-4000-8000-000000000001";
  const USER = "11111111-1111-1111-1111-111111111111";
  const before = await db.query<{ sync_failures: number; next_sync_at: string | null }>(
    "SELECT sync_failures, next_sync_at FROM calendar_accounts WHERE id = $1",
    [ACCOUNT],
  );
  let failAck = 0;
  let failRetry = 0;
  const n = await consumeCalendarSyncBatch(
    {
      messages: [
        {
          body: { account_id: ACCOUNT, user_id: USER, provider: "google" },
          ack: () => { failAck += 1; },
          retry: () => { failRetry += 1; },
        },
      ],
    },
    { CUTOVER_FLIPPED: "1" },
    sql,
  );
  const after = await db.query<{ sync_failures: number; next_sync_at: string | Date | null }>(
    "SELECT sync_failures, next_sync_at FROM calendar_accounts WHERE id = $1",
    [ACCOUNT],
  );
  const nextAt = after.rows[0]?.next_sync_at ? new Date(after.rows[0].next_sync_at).getTime() : 0;
  ok(n === 1 && failAck === 1 && failRetry === 0, "failed Google account acks (backoff, not queue retry)");
  ok(
    Number(after.rows[0]?.sync_failures ?? 0) > Number(before.rows[0]?.sync_failures ?? 0),
    "failed Google account increments sync_failures",
  );
  ok(nextAt > Date.now(), "failed Google account sets next_sync_at in the future");
  await db.close();
}

{
  const db = new PGlite();
  await applyIsolationSchema(db);
  const sql = makePgliteSql(db);
  const USER = "11111111-1111-1111-1111-111111111111";
  const accounts = [
    { provider: "m365", id: "aaaaaaaa-eeee-4000-8000-000000000011" },
    { provider: "icloud", id: "aaaaaaaa-eeee-4000-8000-000000000012" },
    { provider: "ics", id: "aaaaaaaa-eeee-4000-8000-000000000013" },
  ] as const;
  for (const account of accounts) {
    const before = await db.query<{ sync_failures: number; next_sync_at: string | null }>(
      "SELECT sync_failures, next_sync_at FROM calendar_accounts WHERE id = $1",
      [account.id],
    );
    let failAck = 0;
    let failRetry = 0;
    const n = await consumeCalendarSyncBatch(
      {
        messages: [
          {
            body: { account_id: account.id, user_id: USER, provider: account.provider },
            ack: () => { failAck += 1; },
            retry: () => { failRetry += 1; },
          },
        ],
      },
      { CUTOVER_FLIPPED: "1" },
      sql,
    );
    const after = await db.query<{ sync_failures: number; next_sync_at: string | Date | null }>(
      "SELECT sync_failures, next_sync_at FROM calendar_accounts WHERE id = $1",
      [account.id],
    );
    const nextAt = after.rows[0]?.next_sync_at ? new Date(after.rows[0].next_sync_at).getTime() : 0;
    ok(n === 1 && failAck === 1 && failRetry === 0, `failed ${account.provider} account acks (backoff, not queue retry)`);
    ok(
      Number(after.rows[0]?.sync_failures ?? 0) > Number(before.rows[0]?.sync_failures ?? 0),
      `failed ${account.provider} account increments sync_failures`,
    );
    ok(nextAt > Date.now(), `failed ${account.provider} account sets next_sync_at in the future`);
  }
  await db.close();
}

for (const value of flipOn) {
  const out = await runCronJob("google-renew", { CUTOVER_FLIPPED: value }, null);
  ok(out.skipped !== true && out.status === 501, `runCronJob google-renew after ${value} is not skipped (needs sql)`);
}

const bearerSkip = gateCronBearerRoute({}, "github-activity");
ok(bearerSkip !== null && bearerSkip.status === 200, "gateCronBearerRoute skips before any DB");
const bearerBody = (await bearerSkip!.json()) as { job?: string; skipped?: boolean };
ok(bearerBody.job === "github-activity" && bearerBody.skipped === true, "gateCronBearerRoute names the route");

const maintUnset = await app.request("http://localhost/api/maintenance", {}, {});
ok(maintUnset.status === 200, "GET /api/maintenance unset: 200");
ok(maintUnset.headers.get("Cache-Control") === "no-store", "GET /api/maintenance sets Cache-Control: no-store");
const maintUnsetBody = (await maintUnset.json()) as Record<string, unknown>;
ok(maintUnsetBody.cutover_flipped === false, "maintenance cutover_flipped is false when unset");
ok(maintUnsetBody.write_freeze === false && maintUnsetBody.cutover_armed === false, "maintenance other flags stay booleans");
ok(!("CUTOVER_FLIPPED" in maintUnsetBody), "maintenance does not echo CUTOVER_FLIPPED");
const maintKeys = Object.keys(maintUnsetBody).sort();
ok(
  maintKeys.join(",") === "cutover_armed,cutover_flipped,message,write_freeze",
  `maintenance keys are only the four flags: ${maintKeys.join(",")}`,
);

const maintOn = await app.request("http://localhost/api/maintenance", {}, { CUTOVER_FLIPPED: "1" });
const maintOnBody = (await maintOn.json()) as Record<string, unknown>;
ok(maintOnBody.cutover_flipped === true, "maintenance cutover_flipped is true after allowlist");
ok(typeof maintOnBody.cutover_flipped === "boolean", "maintenance cutover_flipped is a boolean");
ok(!Object.values(maintOnBody).includes("1"), "maintenance does not echo the env string");

for (const value of [1, true, false, 0, { toString: () => "1" }, ["1"]]) {
  const res = await app.request("http://localhost/api/maintenance", {}, { CUTOVER_FLIPPED: value as never });
  ok(res.status === 200, `maintenance non-string flip ${typeof value}: 200 not 500`);
  const body = (await res.json()) as { cutover_flipped?: boolean; write_freeze?: boolean };
  ok(body.cutover_flipped === false, `maintenance non-string flip ${typeof value} is cutover_flipped=false`);
}

for (const value of [1, true, false, 0, { toString: () => "1" }, ["1"]]) {
  let threw = false;
  let frozen = false;
  try {
    frozen = writeFrozen(value);
  } catch {
    threw = true;
  }
  ok(!threw && frozen === true, `writeFrozen present non-string ${typeof value} freezes (fail-closed)`);
}
ok(!writeFrozen(undefined) && !writeFrozen(null) && !writeFrozen(""), "writeFrozen unset/empty is off");
ok(writeFrozen("1") && writeFrozen("TRUE"), "writeFrozen allowlist still on");
ok(writeFrozen("garbage") && writeFrozen("typo"), "writeFrozen unknown string is frozen (fail-closed)");
ok(!writeFrozen("0") && !writeFrozen("false"), "writeFrozen explicit off stays open");

for (const value of [1, true, { toString: () => "1" }]) {
  const res = await app.request("http://localhost/api/maintenance", {}, { MAINTENANCE_WRITE_FREEZE: value as never });
  ok(res.status === 200, `maintenance non-string freeze ${typeof value}: 200 not 500`);
  const body = (await res.json()) as { write_freeze?: boolean };
  ok(body.write_freeze === true, `maintenance non-string freeze ${typeof value} is write_freeze=true`);
}

const doc = readFileSync(join(here, "../../docs/cloudflare-cutover.md"), "utf8");
ok(/cutover_flipped: true/.test(doc), "runbook confirms GET /api/maintenance cutover_flipped");
ok(/non-skipped/.test(doc) && /cutover_not_flipped/.test(doc), "runbook confirms one job actually ran");
const step4 = doc.split("4. **Confirm the flip landed.**")[1]?.split("\n## ")[0] ?? "";
ok(/\/api\/cron\/rollover/.test(step4) && /\/api\/cron\/calendar-dispatch/.test(step4), "runbook step 4 fires a ported cron");
ok(/not `github-poll` or `trim-sync-log`/.test(step4), "runbook step 4 excludes github-poll and trim-sync-log");

restoreIo();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("cutoverFlip: ok");
