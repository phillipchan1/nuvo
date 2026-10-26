// Run: node --experimental-strip-types worker/src/secrets.check.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openToken,
  parseRawKey,
  parseTokenKeyring,
  sealToken,
  tokenAadString,
  TOKEN_KEY_VERSION_V1,
  TOKEN_KEY_VERSION_V2,
} from "./secrets.ts";
import { jobsForSchedule, canonicalCronJob, consumeCalendarSyncBatch } from "./cronJobs.ts";
import { writeFrozen } from "./maintenance.ts";

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

ok(tokenAadString(aad) === `calendar_accounts:${aad.rowId}:${aad.userId}`, "AAD is table:row:user");

ok(writeFrozen("1"), "writeFrozen 1");
ok(writeFrozen("true"), "writeFrozen true");
ok(writeFrozen("YES"), "writeFrozen YES");
ok(!writeFrozen(""), "writeFrozen empty is off");
ok(!writeFrozen(undefined), "writeFrozen unset is off");

ok(canonicalCronJob("nuvo-calendar-dispatch") === "calendar-dispatch", "cron alias calendar-dispatch");
ok(canonicalCronJob("nuvo-rollover-pdt") === "rollover", "cron alias rollover");
ok(jobsForSchedule("* * * * *").includes("calendar-dispatch"), "minute tick includes calendar-dispatch");
ok(jobsForSchedule("* * * * *").includes("push-dispatch"), "minute tick includes push-dispatch");
ok(jobsForSchedule("15 9 * * *").includes("google-renew"), "09:15 UTC is google-renew");
ok(jobsForSchedule("0 4 * * *").includes("purge-trash"), "04:00 UTC is purge-trash");

let acked = 0;
const consumed = consumeCalendarSyncBatch({
  messages: [
    { body: { account_id: "x", user_id: "y", provider: "google" }, ack: () => { acked += 1; } },
    { body: { account_id: "x2", user_id: "y2", provider: "ics" }, ack: () => { acked += 1; } },
  ],
});
ok(consumed === 2 && acked === 2, "queue scaffold acks every message");

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

const neon = readFileSync(join(root, "worker/schema/neon.sql"), "utf8");
ok(/CREATE TABLE IF NOT EXISTS public\.calendar_accounts/.test(neon), "neon.sql has calendar_accounts");
ok(/CREATE TABLE IF NOT EXISTS public\.external_events/.test(neon), "neon.sql has external_events");
ok(/CREATE TABLE IF NOT EXISTS public\.push_subscriptions/.test(neon), "neon.sql has push_subscriptions");
ok(/CREATE TABLE IF NOT EXISTS public\.activity_sources/.test(neon), "neon.sql has activity_sources");
ok(/CREATE TABLE IF NOT EXISTS public\.apple_identities/.test(neon), "neon.sql has apple_identities");
ok(/refresh_token_enc BYTEA/.test(neon), "neon.sql has encrypted token columns");

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("secrets: ok");
