// Run: node --experimental-strip-types worker/src/secrets.check.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openToken,
  parseRawKey,
  parseTokenKeyring,
  sealToken,
  tokenAadBytes,
  tokenAadString,
  TOKEN_KEY_VERSION_V1,
  TOKEN_KEY_VERSION_V2,
} from "./secrets.ts";
import { jobsForSchedule, canonicalCronJob, consumeCalendarSyncBatch, handleScheduled, runCronJob } from "./cronJobs.ts";
import { cutoverFlipped, gateCron, gateCronBearerRoute, POST_FLIP_CRON_JOBS } from "./cutoverFlip.ts";
import { writeFrozen } from "./maintenance.ts";
import { redactSecrets } from "./lib/redact.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const keyHex = "00".repeat(32);
const keyHex2 = "11".repeat(32);
const aad = { table: "calendar_accounts", rowId: "aaaaaaaa-eeee-4000-8000-000000000001", userId: "11111111-1111-1111-1111-111111111111" };
const otherRow = { ...aad, rowId: "bbbbbbbb-eeee-4000-8000-000000000001" };
const otherUser = { ...aad, userId: "22222222-2222-2222-2222-222222222222" };

ok(parseRawKey(keyHex).length === 32, "parseRawKey hex is 32 bytes");
ok(parseRawKey(Buffer.from(keyHex, "hex").toString("base64")).length === 32, "parseRawKey base64 is 32 bytes");
try {
  parseRawKey("short");
  ok(false, "parseRawKey rejects short key");
} catch {
  ok(true, "parseRawKey rejects short key");
}

const ringV1 = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: keyHex });
ok(ringV1.current.version === TOKEN_KEY_VERSION_V1, "keyring defaults to v1");

const sealed = await sealToken("1//google-refresh", aad, ringV1);
ok(sealed.iv.length === 12, "seal iv is 12 bytes");
ok(sealed.ciphertext.length > 16, "seal ciphertext includes tag");
ok(sealed.keyVersion === 1, "seal uses current version");

const opened = await openToken(sealed, aad, ringV1);
ok(opened === "1//google-refresh", "open roundtrips");

try {
  await openToken(sealed, otherRow, ringV1);
  ok(false, "open rejects moved row AAD");
} catch (err) {
  ok(err instanceof Error && !String(err.message).includes("1//"), "open rejects moved row AAD without leaking plaintext");
}

try {
  await openToken(sealed, otherUser, ringV1);
  ok(false, "open rejects moved user AAD");
} catch {
  ok(true, "open rejects moved user AAD");
}

const tamperedCipher = new Uint8Array(sealed.ciphertext);
tamperedCipher[0] ^= 0xff;
try {
  await openToken({ ...sealed, ciphertext: tamperedCipher }, aad, ringV1);
  ok(false, "open rejects tampered ciphertext");
} catch {
  ok(true, "open rejects tampered ciphertext");
}

try {
  await openToken(sealed, { ...aad, table: "activity_sources" }, ringV1);
  ok(false, "open rejects tampered AAD table");
} catch {
  ok(true, "open rejects tampered AAD table");
}

const ringWrong = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: keyHex2 });
try {
  await openToken(sealed, aad, ringWrong);
  ok(false, "open rejects the wrong key");
} catch {
  ok(true, "open rejects the wrong key");
}

const ringBoth = await parseTokenKeyring({
  TOKEN_ENC_KEY_V1: keyHex,
  TOKEN_ENC_KEY_V2: keyHex2,
  TOKEN_ENC_CURRENT: "2",
});
ok(ringBoth.current.version === TOKEN_KEY_VERSION_V2, "TOKEN_ENC_CURRENT=2 seals with v2");
const sealedV2 = await sealToken("ghp_example", { table: "activity_sources", rowId: aad.rowId, userId: aad.userId }, ringBoth);
ok(sealedV2.keyVersion === 2, "v2 seal records key_version 2");
ok((await openToken(sealedV2, { table: "activity_sources", rowId: aad.rowId, userId: aad.userId }, ringBoth)) === "ghp_example", "v2 open roundtrips");
ok((await openToken(sealed, aad, ringBoth)) === "1//google-refresh", "v2 ring still opens v1 ciphertext");

ok(tokenAadString(aad) === `calendar_accounts:${aad.rowId}:${aad.userId}`, "AAD string is table:row:user");
try {
  tokenAadString({ ...aad, rowId: "not-a-uuid" });
  ok(false, "AAD rejects a non-uuid row");
} catch {
  ok(true, "AAD rejects a non-uuid row");
}
ok(tokenAadBytes(aad)[0] === 0 && tokenAadBytes(aad)[1] === "calendar_accounts".length, "AAD bytes are length-prefixed");

ok(redactSecrets("Bearer ya29.abc-token 1//refresh-xyz") === "Bearer [redacted] [redacted]", "redactSecrets strips bearer and google tokens");
ok(redactSecrets("access_token=ya29.leak refresh_token=1//leak").includes("[redacted]"), "redactSecrets strips token query pairs");
ok(!redactSecrets("boom ya29.secret-value").includes("ya29."), "redactSecrets drops ya29 material");
ok(!redactSecrets("id_token=eyJhbGciOiJIUzI1NiJ9.e30.abc").includes("eyJ"), "redactSecrets strips id_token");
ok(redactSecrets("id_token=eyJhbGciOiJIUzI1NiJ9.e30.abc").includes("id_token=[redacted]"), "redactSecrets replaces id_token value");
const jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signature";
ok(!redactSecrets(`jwt ${jwt} leftover`).includes("eyJ"), "redactSecrets strips compact JWTs");
ok(redactSecrets("client_secret=GOCSPX-leak").includes("client_secret=[redacted]"), "redactSecrets strips client_secret");
ok(!redactSecrets("client_secret=GOCSPX-leak").includes("GOCSPX"), "redactSecrets drops client_secret material");
ok(!redactSecrets("https://oauth?code=4/0AanRRrt-secret&scope=email").includes("4/0Aan"), "redactSecrets strips OAuth code=4/…");
ok(redactSecrets("https://oauth?code=4/0AanRRrt-secret&scope=email").includes("code=[redacted]"), "redactSecrets replaces OAuth code");

const REDACT_CASES: { name: string; input: string; mustNot: string; mustInclude: string }[] = [
  { name: "JSON id_token", input: '{"id_token":"eyJhbGciOiJIUzI1NiJ9.e30.sig"}', mustNot: "eyJ", mustInclude: "[redacted]" },
  { name: "JSON client_secret", input: '{"client_secret":"GOCSPX-json"}', mustNot: "GOCSPX", mustInclude: '"client_secret":"[redacted]"' },
  { name: "JSON refresh_token", input: '{"refresh_token":"1//json-refresh"}', mustNot: "json-refresh", mustInclude: "[redacted]" },
  { name: "JSON access_token", input: '{"access_token":"ya29.json-access"}', mustNot: "json-access", mustInclude: "[redacted]" },
  { name: "urlencoded refresh_token", input: "refresh_token%3D1%2F%2Furl-refresh", mustNot: "url-refresh", mustInclude: "refresh_token%3D[redacted]" },
  { name: "urlencoded access_token", input: "access_token%3Dya29.url-access", mustNot: "url-access", mustInclude: "access_token%3D[redacted]" },
  { name: "urlencoded client_secret", input: "client_secret%3DGOCSPX-url", mustNot: "GOCSPX-url", mustInclude: "client_secret%3D[redacted]" },
  { name: "code=4/ in query", input: "https://oauth?state=1&code=4/0Aan-mid&scope=email", mustNot: "0Aan-mid", mustInclude: "code=[redacted]" },
  { name: "code=4/ after quote", input: 'redirect "code=4/quoted-secret"', mustNot: "quoted-secret", mustInclude: "code=[redacted]" },
  { name: "2-part JWT", input: "hdr eyJhbGciOiJIUzI1NiJ9.e30 tail", mustNot: "eyJ", mustInclude: "[redacted]" },
  { name: "Basic auth", input: "Authorization: Basic YWJjOnNlY3JldA==", mustNot: "YWJjOnNlY3JldA", mustInclude: "Basic [redacted]" },
  { name: "single-quoted client_secret", input: "client_secret='GOCSPX-quoted'", mustNot: "GOCSPX-quoted", mustInclude: "client_secret='[redacted]'" },
  { name: "single-quoted refresh_token", input: "refresh_token='plain-refresh'", mustNot: "plain-refresh", mustInclude: "refresh_token='[redacted]'" },
  { name: "client_secret spaced =", input: "client_secret = spaced-secret", mustNot: "spaced-secret", mustInclude: "client_secret = [redacted]" },
];
for (const row of REDACT_CASES) {
  const out = redactSecrets(row.input);
  ok(!out.includes(row.mustNot), `redact ${row.name} drops secret`);
  ok(out.includes(row.mustInclude), `redact ${row.name} keeps placeholder`);
}

ok(writeFrozen("1"), "writeFrozen 1");
ok(writeFrozen("true"), "writeFrozen true");
ok(writeFrozen("YES"), "writeFrozen YES");
ok(writeFrozen("maybe"), "writeFrozen maybe is frozen (fail-closed)");
ok(writeFrozen("typo"), "writeFrozen typo is frozen");
ok(!writeFrozen(""), "writeFrozen empty is off");
ok(!writeFrozen(undefined), "writeFrozen unset is off");
ok(!writeFrozen(null), "writeFrozen null is off");
ok(!writeFrozen("0"), "writeFrozen 0 is off");
ok(!writeFrozen("false"), "writeFrozen false is off");
ok(!writeFrozen("no"), "writeFrozen no is off");
ok(!writeFrozen("off"), "writeFrozen off is off");
for (const value of [1, true, false, 0, { toString: () => "1" }]) {
  let threw = false;
  let frozen = false;
  try {
    frozen = writeFrozen(value);
  } catch {
    threw = true;
  }
  ok(!threw && frozen === true, `writeFrozen present non-string ${typeof value} freezes`);
}

ok(cutoverFlipped("1"), "cutoverFlipped 1");
ok(cutoverFlipped("true"), "cutoverFlipped true");
ok(cutoverFlipped("YES"), "cutoverFlipped YES");
ok(cutoverFlipped("on"), "cutoverFlipped on");
ok(!cutoverFlipped(""), "cutoverFlipped empty is off");
ok(!cutoverFlipped(undefined), "cutoverFlipped unset is fail-closed");
ok(!cutoverFlipped("maybe"), "cutoverFlipped unknown is fail-closed");
ok(!cutoverFlipped("0"), "cutoverFlipped 0 is fail-closed");
ok(!cutoverFlipped("false"), "cutoverFlipped false is fail-closed");
ok(!cutoverFlipped("2"), "cutoverFlipped 2 is fail-closed");
const here = dirname(fileURLToPath(import.meta.url));
const cronSrc = readFileSync(join(here, "cron.ts"), "utf8");
const flipSrc = readFileSync(join(here, "cutoverFlip.ts"), "utf8");
ok(!/export function cutoverFlipped/.test(cronSrc), "cron.ts no longer owns cutoverFlipped");
ok(/export function cutoverFlipped/.test(flipSrc) && !/writeFrozen\(/.test(flipSrc), "cutoverFlipped lives in cutoverFlip.ts and does not derive from writeFrozen");
ok(!/\bwriteFrozen\s*\(/.test(flipSrc), "cutoverFlipped does not call writeFrozen");
ok(!/from "\.\/maintenance/.test(flipSrc), "cutoverFlip.ts is independent of maintenance.ts");
ok(/export function gateCron/.test(flipSrc) && /export function gateCronBearerRoute/.test(flipSrc), "cutoverFlip exports gateCron + gateCronBearerRoute");
ok(
  !existsSync(join(here, "lib/secrets.ts")),
  "stub lib/secrets.ts is deleted",
);
ok(POST_FLIP_CRON_JOBS.includes("push-dispatch") && POST_FLIP_CRON_JOBS.includes("github-poll") && POST_FLIP_CRON_JOBS.includes("trim-sync-log"), "POST_FLIP_CRON_JOBS lists Worker copies");
ok(gateCron({}, "github-poll") instanceof Response, "gateCron skips before flip");
ok(gateCronBearerRoute({ CUTOVER_FLIPPED: "on" }, "github-poll") === null, "gateCronBearerRoute null after flip");

const skipPush = await runCronJob("push-dispatch", {}, null);
ok(skipPush.skipped === true && skipPush.status === 200 && skipPush.reason === "cutover_not_flipped", "runCronJob skips push-dispatch before flip");
ok(skipPush.ok === true && !("stay_on_supabase" in skipPush), "skipped cron uses cutover skip shape (no stay_on_supabase)");
const skipUnknown = await runCronJob("rollover", { CUTOVER_FLIPPED: "maybe" }, null);
ok(skipUnknown.skipped === true && skipUnknown.reason === "cutover_not_flipped", "unknown CUTOVER_FLIPPED skips rollover");
const skipCalendar = await runCronJob("calendar-dispatch", { CUTOVER_FLIPPED: "" }, null);
ok(skipCalendar.skipped === true && skipCalendar.reason === "cutover_not_flipped", "empty CUTOVER_FLIPPED skips calendar-dispatch");
const scheduledSkip = await handleScheduled({ cron: "* * * * *" }, {}, (job) => runCronJob(job, {}, null));
ok(
  scheduledSkip.length === 2 && scheduledSkip.every((r) => r.skipped === true && r.reason === "cutover_not_flipped"),
  "minute tick skips every job before flip",
);
const flippedNoSql = await runCronJob("push-dispatch", { CUTOVER_FLIPPED: "1" }, null);
ok(flippedNoSql.status === 501 && flippedNoSql.skipped !== true, "flipped push-dispatch without sql is 501");
const pollSkip = await runCronJob("github-poll", {}, null);
ok(pollSkip.status === 200 && pollSkip.skipped === true && pollSkip.reason === "cutover_not_flipped", "runCronJob github-poll skips before flip");
const trimSkip = await runCronJob("nuvo-trim-sync-log", { CUTOVER_FLIPPED: "false" }, null);
ok(trimSkip.status === 200 && trimSkip.skipped === true, "runCronJob trim skips unknown value");
const pollFlippedNoSql = await runCronJob("github-poll", { CUTOVER_FLIPPED: "1" }, null);
ok(pollFlippedNoSql.status === 501, "runCronJob after flip still needs sql");

ok(canonicalCronJob("nuvo-calendar-dispatch") === "calendar-dispatch", "cron alias calendar-dispatch");
ok(canonicalCronJob("nuvo-rollover-pdt") === "rollover", "cron alias rollover");
ok(jobsForSchedule("* * * * *").includes("calendar-dispatch"), "minute tick includes calendar-dispatch");
ok(jobsForSchedule("* * * * *").includes("push-dispatch"), "minute tick includes push-dispatch");
ok(jobsForSchedule("15 9 * * *").includes("google-renew"), "09:15 UTC is google-renew");
ok(jobsForSchedule("0 4 * * *").includes("purge-trash"), "04:00 UTC is purge-trash");
ok(jobsForSchedule("20 9 * * *").includes("github-poll"), "09:20 UTC is github-poll");
ok(jobsForSchedule("0 10 * * 0").includes("trim-sync-log"), "Sunday 10:00 UTC is trim-sync-log");
ok(canonicalCronJob("nuvo-github-poll") === "github-poll", "cron alias github-poll");
ok(canonicalCronJob("nuvo-trim-sync-log") === "trim-sync-log", "cron alias trim-sync-log");

const ghSrc = readFileSync(join(root, "worker/src/githubActivity.ts"), "utf8");
ok(/SYNC_LOG_SEQUENCE_MARGIN = 1_000_000/.test(ghSrc), "trim: parked margin is 1e6");
ok(/id < \$\{parkedFloor\}/.test(ghSrc), "trim: floor excludes Neon-origin ids");
ok(/about 1e6[\s\S]*further Neon inserts/.test(ghSrc), "trim: floor rises after ~1e6 Neon inserts");
ok(/gateCronBearerRoute\(\s*c\.env\s*,\s*["']github-poll["']\s*\)/.test(ghSrc), "github-activity cron sync uses gateCronBearerRoute(c.env, 'github-poll')");
ok(ghSrc.indexOf("gateCronBearerRoute") < ghSrc.indexOf("requestIo(c)"), "github-activity cron sync gates before requestIo");
ok(!/RESTART IDENTITY/.test(ghSrc) && !/setval\(/.test(ghSrc), "trim: never resets the parked identity");
ok(/from "\.\/secrets\.ts"/.test(ghSrc), "github-activity: uses A's secrets.ts");
ok(!/lib\/secrets/.test(ghSrc), "github-activity: no duplicate secrets module");
ok(/writeFrozen\(c\.env\.MAINTENANCE_WRITE_FREEZE\)/.test(ghSrc), "github-activity: writeFrozen after auth");
ok(/requireStore\(c\)/.test(ghSrc), "github-activity: owner from session requireStore");

const cronJobsSrc = readFileSync(join(root, "worker/src/cronJobs.ts"), "utf8");
ok(/runGithubPoll/.test(cronJobsSrc) && /runTrimSyncLog/.test(cronJobsSrc), "cronJobs: github-poll and trim-sync-log are wired");
ok(/name === "github-poll"/.test(cronJobsSrc) && /name === "trim-sync-log"/.test(cronJobsSrc), "cronJobs: both jobs have runners");
ok(/gateCron\(env, name\)/.test(cronJobsSrc) && /gateCron\(c\.env, name\)/.test(cronJobsSrc), "cronJobs: handleCron and runCronJob use gateCron");
ok(/from "\.\/cutoverFlip\.ts"/.test(cronJobsSrc), "cronJobs: flip helpers imported from cutoverFlip.ts");
ok(!/nowMs:\s*typeof body\.nowMs/.test(cronJobsSrc), "HTTP cron does not forward caller nowMs");
ok(!/opts\.nowMs|body\.nowMs/.test(cronJobsSrc), "handleCron never reads body.nowMs");

const blockedSrc = readFileSync(join(root, "worker/src/blocked.ts"), "utf8");
ok(!/"github-activity"/.test(blockedSrc), "blocked: github-activity is ported");
ok(!/"github-poll"/.test(blockedSrc), "blocked: github-poll is ported");

const pat = "github_pat_11AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ghAad = { table: "activity_sources", rowId: aad.rowId, userId: aad.userId };
const sealedGh = await sealToken(pat, ghAad, ringV1);
const openedGh = await openToken(sealedGh, ghAad, ringV1);
ok(openedGh.startsWith("github_pat_") && openedGh.length === pat.length, "github PAT: open prefix/length only");
ok(openedGh === pat, "github PAT: round-trip");
try {
  await openToken(sealedGh, { ...ghAad, userId: otherUser.userId }, ringV1);
  ok(false, "github PAT: AAD user mismatch fails");
} catch {
  ok(true, "github PAT: AAD user mismatch fails");
}

let acked = 0;
let retried = 0;
const consumed = await consumeCalendarSyncBatch(
  {
    messages: [
      { body: { account_id: "x", user_id: "y", provider: "google" }, ack: () => { acked += 1; }, retry: () => { retried += 1; } },
      { body: { account_id: "x2", user_id: "y2", provider: "ics" }, ack: () => { acked += 1; }, retry: () => { retried += 1; } },
    ],
  },
  {},
);
ok(consumed === 2 && acked === 2 && retried === 0, "queue consumer acks when not flipped (no IO)");
let flippedAck = 0;
let flippedRetry = 0;
const flippedConsumed = await consumeCalendarSyncBatch(
  {
    messages: [
      { body: { account_id: "x", user_id: "y", provider: "google" }, ack: () => { flippedAck += 1; }, retry: () => { flippedRetry += 1; } },
      { body: { account_id: "x2", user_id: "y2", provider: "ics" }, ack: () => { flippedAck += 1; }, retry: () => { flippedRetry += 1; } },
    ],
  },
  { CUTOVER_FLIPPED: "1" },
);
ok(flippedConsumed === 2 && flippedRetry === 1 && flippedAck === 1, "flipped queue: google without sql retries; other providers ack");

const vaultSql = readFileSync(join(root, "docs/cloudflare-migration/vault_tokens.sql"), "utf8");
ok(/SECURITY DEFINER/i.test(vaultSql), "vault_tokens.sql is SECURITY DEFINER");
ok(/search_path\s*=\s*''/.test(vaultSql), "vault_tokens.sql search_path is empty");
ok(/OWNER TO postgres/.test(vaultSql), "vault_tokens.sql owner is postgres");
ok(/GRANT EXECUTE ON FUNCTION migration_tmp\.vault_tokens\(\) TO migration_reader/.test(vaultSql), "vault_tokens.sql EXECUTE for migration_reader");
ok(/REVOKE ALL ON FUNCTION migration_tmp\.vault_tokens\(\) FROM PUBLIC/.test(vaultSql), "vault_tokens.sql revokes PUBLIC");
ok(/REVOKE ALL ON FUNCTION migration_tmp\.vault_tokens\(\) FROM anon/.test(vaultSql), "vault_tokens.sql revokes anon");
ok(/REVOKE ALL ON FUNCTION migration_tmp\.vault_tokens\(\) FROM authenticated/.test(vaultSql), "vault_tokens.sql revokes authenticated");
ok(/REVOKE ALL ON FUNCTION migration_tmp\.vault_tokens\(\) FROM service_role/.test(vaultSql), "vault_tokens.sql revokes service_role");
ok(/RETURNS TABLE/.test(vaultSql) && /table_name text/.test(vaultSql) && /secret text/.test(vaultSql), "vault_tokens.sql returns the minimal columns");

const workflow = readFileSync(join(root, ".github/workflows/cutover-migrate.yml"), "utf8");
ok(!/psql.*vault_tokens\.sql/.test(workflow), "cutover-migrate.yml does not apply vault_tokens.sql");
ok(!/-f .*vault_tokens/.test(workflow), "cutover-migrate.yml does not -f vault_tokens.sql");
ok(!/-f .*freeze\.sql/.test(workflow), "cutover-migrate.yml does not -f freeze.sql");
ok(!/-f .*unfreeze\.sql/.test(workflow), "cutover-migrate.yml does not -f unfreeze.sql");
ok(/BILLING_TABLES/.test(workflow), "cutover-migrate.yml names BILLING_TABLES");
ok(/COPY_SKIP_TABLES/.test(workflow) && /sync_log/.test(workflow), "cutover-migrate.yml skips sync_log from the frozen copy");
const copyPy = readFileSync(join(root, "scripts/cutover_copy.py"), "utf8");
ok(/--exclude-table=public\.\{name\}/.test(copyPy), "cutover_copy.py excludes billing tables from the dump");
ok(/--exclude-table-data=public\.sync_log/.test(copyPy), "cutover_copy.py keeps sync_log structure (--exclude-table-data)");
ok(/dump_exclude_args/.test(workflow), "cutover-migrate.yml uses dump_exclude_args for the frozen copy");
ok(/require_write_freeze_preflight/.test(workflow) && /edge preflight expected 503/.test(workflow), "cutover-migrate.yml preflights a gated edge 503");
ok(/anon INSERT on public\.sync_log/.test(workflow), "cutover-migrate.yml aborts if anon insert is still granted");
ok(/source-snapshot\.json/.test(workflow), "cutover-migrate.yml records a frozen-table snapshot");
ok(/subscriptions/.test(workflow) && /stripe_webhook_events/.test(workflow) && /apple_webhook_events/.test(workflow), "cutover-migrate.yml lists billing tables");
ok(/require_cutover_armed/.test(workflow) && /MAINTENANCE_URL/.test(workflow), "cutover-migrate.yml refuses dump unless maintenance is armed");
ok(/cmd_resync/.test(workflow) && /id anti-join/.test(workflow), "cutover-migrate.yml resyncs sync_log by missing id");
ok(/sync_log_resync_txn_sql/.test(workflow), "cutover-migrate.yml setvals sync_log in the anti-join transaction");
ok(/last_value FROM/.test(copyPy) && /GREATEST\(/.test(copyPy), "cutover_copy.py setval is GREATEST(max(id), last_value, 1)");
ok(/LOCK TABLE public\.sync_log/.test(copyPy), "cutover_copy.py locks sync_log for the resync transaction");
ok(/SYNC_LOG_LOCK_TIMEOUT = "10s"/.test(copyPy) && /sync_log_set_lock_timeout_sql\(local=True\)/.test(copyPy) && copyPy.indexOf("sync_log_set_lock_timeout_sql(local=True)") < copyPy.indexOf("LOCK TABLE public.sync_log"), "cutover_copy.py sets lock_timeout before LOCK TABLE");
ok(/sync_log_set_lock_timeout_sql\(\)/.test(copyPy) && copyPy.indexOf("sync_log_set_lock_timeout_sql()") < copyPy.indexOf("CREATE TEMP TABLE cutover_sync_log_src"), "cutover_copy.py sets session lock_timeout before the temp-table load");
ok(/WHEN lock_not_available/.test(copyPy) && !/WHEN query_canceled/.test(copyPy), "cutover_copy.py catches lock_not_available (55P03), not query_canceled");
ok(/retry the resync \(retryable\)/.test(copyPy), "cutover_copy.py lock timeout is retryable");
ok(/retryable_lock_timeout_stop\(err\)/.test(workflow), "cutover-migrate.yml includes the redacted psql error on lock timeout");
ok(/incoming row\(s\) differ on Neon/.test(copyPy), "cutover_copy.py aborts sync_log content collisions with a count");
ok(/sync_log_reserve_sequence_sql/.test(workflow) && /SYNC_LOG_SEQUENCE_MARGIN/.test(copyPy), "cutover-migrate.yml reserves sync_log identity past source max after restore");
ok(/SYNC_LOG_SEQUENCE_MARGIN = 1_000_000/.test(copyPy), "cutover_copy.py parked margin is 1e6 (trim must match)");
const cutoverDoc = readFileSync(join(root, "docs/cloudflare-cutover.md"), "utf8");
ok(/CUTOVER_FLIPPED/.test(cutoverDoc), "cutover.md names CUTOVER_FLIPPED");
ok(/skipped: true/.test(cutoverDoc), "cutover.md documents skipped: true before flip");
ok(/`1`, `true`, `yes`, `on`/.test(cutoverDoc), "cutover.md lists accepted CUTOVER_FLIPPED values");
ok(/unschedule[\s\S]*phase=resync[\s\S]*CUTOVER_FLIPPED/.test(cutoverDoc), "cutover.md step 8 is unschedule → final resync → flag");
ok(/about 1e6 further Neon inserts/.test(cutoverDoc), "cutover.md notes ~1e6 inserts before Neon rows age-trim");
ok(!/Supabase-origin ids are all below the floor/.test(cutoverDoc), "cutover.md softened the floor wording");
ok(!/never deletes ids in the parked identity window/.test(cutoverDoc), "cutover.md no longer says trim keeps the parked window");
ok(/push_anti_join_delete_sql\(\) \+ ";"[\s\S]*push_upsert_sql/.test(workflow), "cutover-migrate.yml deletes missing push rows before upsert");
ok(/push_subscriptions upserted/.test(workflow), "cutover-migrate.yml upserts push_subscriptions");
ok(/sync_log_watermark/.test(workflow), "cutover-migrate.yml records a sync_log watermark");

const freezeSql = readFileSync(join(root, "docs/cloudflare-migration/freeze.sql"), "utf8");
ok(/aclexplode\(c\.relacl\)/.test(freezeSql), "freeze.sql records grants from aclexplode(relacl)");
ok(/PUBLIC/.test(freezeSql), "freeze.sql records PUBLIC grants");
ok(!/has_table_privilege/.test(freezeSql), "freeze.sql does not invent grants from has_table_privilege");
ok(/REVOKE INSERT, UPDATE, DELETE/.test(freezeSql), "freeze.sql revokes writes from browser roles");
ok(/PUBLIC, anon, authenticated/.test(freezeSql), "freeze.sql revokes PUBLIC, anon, and authenticated");
ok(/cron\.alter_job/.test(freezeSql) && /active := false/.test(freezeSql), "freeze.sql pauses pg_cron");
ok(/freeze_cron/.test(freezeSql) && /was_active/.test(freezeSql), "freeze.sql records prior cron.active");
ok(/subscriptions/.test(freezeSql) && /stripe_webhook_events/.test(freezeSql) && /apple_webhook_events/.test(freezeSql), "freeze.sql names billing exclusions");
ok(!/REVOKE[^\n]+service_role/.test(freezeSql), "freeze.sql does not revoke service_role");
ok(/relkind = 'r'/.test(freezeSql) && /attacl/.test(freezeSql), "freeze.sql documents partitions/views/column grants out of scope");

const unfreezeSql = readFileSync(join(root, "docs/cloudflare-migration/unfreeze.sql"), "utf8");
ok(/GRANT %s ON TABLE/.test(unfreezeSql), "unfreeze.sql restores recorded grants");
ok(/FROM migration_tmp\.freeze_grants/.test(unfreezeSql), "unfreeze.sql only re-grants recorded ACL rows");
ok(/already unfrozen/.test(unfreezeSql), "unfreeze.sql is idempotent");
ok(!/RAISE EXCEPTION/.test(unfreezeSql), "unfreeze.sql does not fail when already unfrozen");
ok(/cron\.alter_job/.test(unfreezeSql) && /was_active/.test(unfreezeSql), "unfreeze.sql restores cron.active exactly");
ok(!/GRANT[^\n]+anon, authenticated/.test(unfreezeSql), "unfreeze.sql does not invent direct grants to anon/authenticated");

const maintSrc = readFileSync(join(root, "worker/src/maintenance.ts"), "utf8");
ok(!/export function cutoverFlipped/.test(maintSrc), "maintenance.ts does not own cutoverFlipped");
ok(/writeFreezeOn/.test(maintSrc), "maintenance.ts writeFrozen is writeFreezeOn");

const routesSrc = readFileSync(join(root, "worker/src/google/routes.ts"), "utf8");
const syncWrite = routesSrc.slice(routesSrc.indexOf('paths("google-sync")'), routesSrc.indexOf('paths("google-events")'));
const contactsWrite = routesSrc.slice(routesSrc.indexOf('paths("google-contacts")'), routesSrc.indexOf('paths("calendar-refresh")'));
const syncChunk = syncWrite.slice(syncWrite.indexOf("freezeWrite"));
const contactsChunk = contactsWrite.slice(contactsWrite.indexOf("freezeWrite"));
ok(syncChunk.indexOf("gateCronBearerRoute") < syncChunk.indexOf("requestIo") && syncChunk.includes('gateCronBearerRoute(c.env, "google-sync")'), "google-sync cron bearer uses gateCronBearerRoute before requestIo");
ok(contactsChunk.indexOf("gateCronBearerRoute") < contactsChunk.indexOf("requestIo") && contactsChunk.includes('gateCronBearerRoute(c.env, "google-contacts")'), "google-contacts cron bearer uses gateCronBearerRoute before requestIo");
const eventsWrite = routesSrc.slice(routesSrc.indexOf('paths("google-events")'), routesSrc.indexOf('paths("google-webhook")'));
const eventsChunk = eventsWrite.slice(eventsWrite.indexOf("freezeWrite"));
ok(eventsChunk.includes('gateCronBearerRoute(c.env, "google-events")'), "google-events cron bearer uses gateCronBearerRoute(c.env, 'google-events')");
ok(eventsChunk.indexOf("gateCronBearerRoute") >= 0 && eventsChunk.indexOf("gateCronBearerRoute") < eventsChunk.indexOf("requestIo"), "google-events cron bearer gates before requestIo");

const eventsSrc = readFileSync(join(root, "worker/src/google/events.ts"), "utf8");
ok(!/,\s*"error",\s*String\(e\)/.test(eventsSrc), "events.ts does not write raw String(e) to sync_log");
ok(eventsSrc.includes("redactSecrets"), "events.ts redacts sync_log errors");

const sealSrc = readFileSync(join(root, "scripts/cutover-seal-tokens.mjs"), "utf8");
ok(/access_token_enc BYTEA/.test(sealSrc), "cutover-seal-tokens.mjs adds access_token_enc");
ok(/access_token = NULL/.test(sealSrc), "cutover-seal-tokens.mjs nulls plaintext access_token");
ok(/btrim\(access_token\)/.test(sealSrc) && /leftover/.test(sealSrc), "cutover-seal-tokens.mjs counts leftover plaintext");
ok(/plaintext access_token remains/.test(sealSrc), "cutover-seal-tokens.mjs fails if plaintext remains");
ok(!/console\.(log|error|info)\([^\n]*(row\.access_token|\$\{secret\})/.test(sealSrc), "cutover-seal-tokens.mjs never logs access_token values");
ok(/GITHUB_ACTIONS === ["']true["']/.test(sealSrc), "cutover-seal-tokens.mjs emits ::add-mask:: only in GitHub Actions");
ok(/::add-mask::/.test(sealSrc) && /if \(process\.env\.GITHUB_ACTIONS === ["']true["']\)/.test(sealSrc), "cutover-seal-tokens.mjs gates add-mask on GITHUB_ACTIONS");

const neon = readFileSync(join(root, "worker/schema/neon.sql"), "utf8");
ok(/CREATE TABLE IF NOT EXISTS public\.calendar_accounts/.test(neon), "neon.sql has calendar_accounts");
ok(/CREATE TABLE IF NOT EXISTS public\.external_events/.test(neon), "neon.sql has external_events");
ok(/CREATE TABLE IF NOT EXISTS public\.push_subscriptions/.test(neon), "neon.sql has push_subscriptions");
ok(/CREATE TABLE IF NOT EXISTS public\.activity_sources/.test(neon), "neon.sql has activity_sources");
ok(/CREATE TABLE IF NOT EXISTS public\.apple_identities/.test(neon), "neon.sql has apple_identities");
ok(/refresh_token_enc BYTEA/.test(neon), "neon.sql has encrypted token columns");
ok(/access_token_enc BYTEA/.test(neon), "neon.sql has sealed access_token columns");
ok(/contacts_directory ADD COLUMN IF NOT EXISTS account_id/.test(neon), "neon.sql has contacts_directory.account_id");
ok(/owner-scoped SQL/.test(neon) && /Postgres RLS/.test(neon), "neon.sql documents owner-scoped SQL, not RLS");
ok(/reminder_prefs JSONB/.test(neon), "neon.sql has user_settings.reminder_prefs");
ok(/ADD COLUMN IF NOT EXISTS event_key/.test(neon), "neon.sql has reminders.event_key");
ok(/ADD COLUMN IF NOT EXISTS leads/.test(neon), "neon.sql has reminders.leads");

const storeSrc = readFileSync(join(root, "worker/src/store.ts"), "utf8");
ok(
  /resyncOwnedPushSubscriptions[\s\S]*DELETE FROM push_subscriptions[\s\S]*insertPushSubscription/.test(storeSrc),
  "store push resync deletes missing rows before upsert",
);
ok(
  /ON CONFLICT \(id\) DO UPDATE SET[\s\S]*WHERE push_subscriptions\.user_id = \$\{store\.userId\}/.test(storeSrc),
  "store push upsert is full-row and owner-scoped",
);
ok(!/console\.(log|info|debug|error|warn)\([^)]*(TOKEN_ENC|VAPID_|plaintext|refresh_token)/.test(storeSrc), "store does not log token material");

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("secrets: ok");
