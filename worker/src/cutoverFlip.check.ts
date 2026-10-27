// Run: node --experimental-strip-types worker/src/cutoverFlip.check.ts
import { readdirSync, readFileSync } from "node:fs";
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
import { CRON_BY_SCHEDULE, canonicalCronJob, consumeCalendarSyncBatch, runCronJob } from "./cronJobs.ts";
import type { Sql } from "./db.ts";
import app from "./index.ts";
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
]) {
  ok(POST_FLIP_CRON_JOBS.includes(required), `POST_FLIP_CRON_JOBS includes ${required}`);
}

ok(/gateCron\(env, name\)/.test(cronJobsSrc), "runCronJob calls gateCron");
ok(/gateCron\(c\.env, name\)/.test(cronJobsSrc), "handleCron calls gateCron");
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

for (const file of walkProdTs(here)) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(here.length + 1);
  if (rel === "cron.ts") continue;
  const cronAuth = /\bcronAuthorized\s*\(/.test(src);
  const cronBearer = /CRON_SECRET/.test(src) && /\bbearerToken\s*\(/.test(src);
  if (!cronAuth && !cronBearer) continue;
  ok(
    /\bgateCron\s*\(/.test(src) || /\bgateCronBearerRoute\s*\(/.test(src),
    `${rel}: cronAuthorized / CRON_SECRET-bearer caller is gated by gateCron or gateCronBearerRoute`,
  );
}

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
  const consumed = consumeCalendarSyncBatch(
    {
      messages: [
        { body: { account_id: "x", user_id: "y", provider: "google" }, ack: () => { acked += 1; } },
      ],
    },
    {},
  );
  ok(consumed === 1 && acked === 1, "queue consumer acks when not flipped");
} finally {
  globalThis.fetch = origFetch;
}

for (const value of flipOn) {
  const out = await runCronJob("push-dispatch", { CUTOVER_FLIPPED: value }, throwingSql());
  ok(out.skipped !== true && out.status === 501, `runCronJob push-dispatch runs after ${value} (501 unported)`);
  const http = await app.request("http://localhost/api/cron/push-dispatch", {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  }, { CRON_SECRET: cronSecret, CUTOVER_FLIPPED: value });
  ok(http.status === 501, `handleCron push-dispatch runs after ${value}: HTTP ${http.status}`);
  const body = (await http.json()) as { stay_on_supabase?: boolean; skipped?: boolean };
  ok(body.stay_on_supabase === true && body.skipped !== true, `handleCron push-dispatch after ${value} is stay_on_supabase`);
}

const bearerSkip = gateCronBearerRoute({}, "github-activity");
ok(bearerSkip !== null && bearerSkip.status === 200, "gateCronBearerRoute skips before any DB");
const bearerBody = (await bearerSkip!.json()) as { job?: string; skipped?: boolean };
ok(bearerBody.job === "github-activity" && bearerBody.skipped === true, "gateCronBearerRoute names the route");

const maintUnset = await app.request("http://localhost/api/maintenance", {}, {});
ok(maintUnset.status === 200, "GET /api/maintenance unset: 200");
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

const doc = readFileSync(join(here, "../../docs/cloudflare-cutover.md"), "utf8");
ok(/cutover_flipped: true/.test(doc), "runbook confirms GET /api/maintenance cutover_flipped");
ok(/non-skipped/.test(doc) && /cutover_not_flipped/.test(doc), "runbook confirms one job actually ran");

restoreIo();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("cutoverFlip: ok");
