// GitHub PAT seal/open — prefix/length only, never prints the secret.
// Run: node --experimental-strip-types worker/src/tokenDecrypt.check.ts
//
// The live post-copy `tokenDecrypt.check.ts` (PR A) hits real providers.
// This file is the Worker-side unit: AES-GCM round-trip, AAD binding, and
// a sealed activity_sources row that openToken can read back.

import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import {
  asBytes,
  githubTokenShapeOk,
  importTokenKey,
  openToken,
  parseTokenKeyBytes,
  sealToken,
  tokenAad,
  TokenKeyError,
} from "./lib/secrets.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PAT = "github_pat_11AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const SRC_A = "aaaaaaaa-aaaa-4000-8000-0000000000a1";
const SRC_B = "bbbbbbbb-bbbb-4000-8000-0000000000b1";

ok(parseTokenKeyBytes(KEY_HEX).length === 32, "parseTokenKeyBytes: 32-byte hex");
ok(githubTokenShapeOk(PAT), "github token shape: github_pat_ prefix + length");
ok(githubTokenShapeOk("ghp_" + "x".repeat(36)), "github token shape: ghp_");
ok(!githubTokenShapeOk("not-a-token"), "github token shape: reject unmarked");
ok(!githubTokenShapeOk("ghp_short"), "github token shape: reject short");
ok(tokenAad("activity_sources", SRC_A, A) === `activity_sources:${SRC_A}:${A}`, "AAD is table:row:user");

let threw = false;
try {
  parseTokenKeyBytes("");
} catch (err) {
  threw = err instanceof TokenKeyError;
}
ok(threw, "missing TOKEN_ENC_KEY_V1 throws TokenKeyError");

const key = await importTokenKey(KEY_HEX);
const aadA = tokenAad("activity_sources", SRC_A, A);
const sealed = await sealToken(key, PAT, aadA);
ok(sealed.enc.length > 16, "seal: ciphertext longer than GCM tag");
ok(sealed.iv.length === 12, "seal: 12-byte IV");
ok(sealed.keyVersion === 1, "seal: key_version 1");

const opened = await openToken(key, sealed, aadA);
ok(opened === PAT, "open: round-trip equals input");
ok(githubTokenShapeOk(opened), "open: shape still ok");
ok(opened.startsWith("github_pat_"), "open: github prefix (print prefix only)");

let crossUser = false;
try {
  await openToken(key, sealed, tokenAad("activity_sources", SRC_A, B));
} catch {
  crossUser = true;
}
ok(crossUser, "open: AAD user mismatch fails");

let crossRow = false;
try {
  await openToken(key, sealed, tokenAad("activity_sources", SRC_B, A));
} catch {
  crossRow = true;
}
ok(crossRow, "open: AAD row mismatch fails");

let crossTable = false;
try {
  await openToken(key, sealed, tokenAad("calendar_accounts", SRC_A, A));
} catch {
  crossTable = true;
}
ok(crossTable, "open: AAD table mismatch fails");

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

await sql`
  INSERT INTO activity_sources (id, user_id, kind, login, refresh_token_enc, refresh_token_iv, key_version)
  VALUES (${SRC_A}, ${A}, 'github', 'octo-a', ${sealed.enc}, ${sealed.iv}, ${sealed.keyVersion})
`;

const rows = (await sql`
  SELECT refresh_token_enc, refresh_token_iv, key_version
  FROM activity_sources
  WHERE id = ${SRC_A}
    AND user_id = ${A}
  LIMIT 1
`) as Array<{ refresh_token_enc: unknown; refresh_token_iv: unknown; key_version: number }>;

const storedEnc = asBytes(rows[0]?.refresh_token_enc);
const storedIv = asBytes(rows[0]?.refresh_token_iv);
ok(!!storedEnc && !!storedIv, "row: sealed bytes persisted");
const fromRow = await openToken(
  key,
  { enc: storedEnc!, iv: storedIv!, keyVersion: rows[0]?.key_version ?? 1 },
  aadA,
);
ok(fromRow.length === PAT.length && fromRow.startsWith("github_pat_"), "row: openToken succeeds (shape only)");
ok(fromRow === PAT, "row: decrypted PAT matches");

await db.close();

console.log(`tokenDecrypt github: ${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("tokenDecrypt github: ok");
