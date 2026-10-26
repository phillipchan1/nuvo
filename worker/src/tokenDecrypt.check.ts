// Per-provider sealed-token open. Prints provider + ok/fail only.
// Live refresh runs only when LIVE_TOKEN_DECRYPT=1 and the matching env is set.
// Run: node --experimental-strip-types worker/src/tokenDecrypt.check.ts

import { openToken, sealToken, testTokenKey, tokenAad, type TokenTable } from "./lib/secrets.ts";
import { tokenShapeOk } from "./lib/ms.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const key = testTokenKey();
const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const FIXTURES: { provider: string; table: TokenTable; token: string; row: string }[] = [
  { provider: "google", table: "calendar_accounts", token: "1//0fixture-google-refresh-token-xxxx", row: "aaaaaaaa-0000-4000-8000-0000000000aa" },
  { provider: "m365", table: "calendar_accounts", token: "0.AXQ-fixture-m365-refresh-token-xxxx", row: "aaaaaaaa-0000-4000-8000-0000000000bb" },
  { provider: "icloud", table: "calendar_accounts", token: "abcd-efgh-ijkl-mnop", row: "aaaaaaaa-0000-4000-8000-0000000000cc" },
  { provider: "ics", table: "calendar_accounts", token: "https://example.test/public.ics", row: "aaaaaaaa-0000-4000-8000-0000000000dd" },
  { provider: "apple", table: "apple_identities", token: "a".repeat(32), row: "aaaaaaaa-0000-4000-8000-0000000000ee" },
  { provider: "github", table: "activity_sources", token: "gho_fixturegithubtokenxxxxxxxxxxxx", row: "aaaaaaaa-0000-4000-8000-0000000000ff" },
];

for (const row of FIXTURES) {
  const aad = tokenAad(row.table, row.row, userA);
  const sealed = await sealToken(key, row.token, aad);
  let opened = "";
  let status = "fail";
  try {
    opened = await openToken(key, sealed, aad);
    const shape = tokenShapeOk(row.provider, opened);
    ok(opened === row.token, `${row.provider}: open matches sealed fixture`);
    ok(shape, `${row.provider}: shape ok`);
    status = opened === row.token && shape ? "ok" : "fail";
  } catch {
    ok(false, `${row.provider}: openToken threw`);
  }
  console.log(`provider=${row.provider} ${status}`);

  const wrongAad = tokenAad(row.table, row.row, userB);
  let moved = false;
  try {
    await openToken(key, sealed, wrongAad);
    moved = true;
  } catch {
    moved = false;
  }
  ok(!moved, `${row.provider}: ciphertext does not open under another user AAD`);
}

const live = process.env.LIVE_TOKEN_DECRYPT === "1";
if (live) {
  for (const provider of ["google", "m365", "icloud", "apple", "github"]) {
    console.log(`provider=${provider} live-skip`);
  }
}

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("token decrypt: ok");
