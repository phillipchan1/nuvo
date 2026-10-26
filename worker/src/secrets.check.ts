// Run: node --experimental-strip-types worker/src/secrets.check.ts
import { openToken, sealToken, tokenKeyConfigured } from "./lib/secrets.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
ok(tokenKeyConfigured(key), "32-byte key is configured");
ok(!tokenKeyConfigured(""), "empty key is not configured");
ok(!tokenKeyConfigured("short"), "short key is not configured");

const table = "calendar_accounts";
const row = "aaaaaaaa-0000-4000-8000-000000000001";
const user = "11111111-1111-1111-1111-111111111111";
const sealed = await sealToken(key, table, row, user, "1//refresh-token-shape");
ok(sealed != null && sealed.enc.length > 0 && sealed.iv.length === 12, "sealToken returns enc+iv");

const opened = await openToken(key, table, row, user, sealed!.enc, sealed!.iv, sealed!.keyVersion);
ok(opened === "1//refresh-token-shape", "openToken roundtrips");

const otherUser = await openToken(
  key,
  table,
  row,
  "22222222-2222-2222-2222-222222222222",
  sealed!.enc,
  sealed!.iv,
  sealed!.keyVersion,
).then(
  () => "opened",
  () => "rejected",
);
ok(otherUser === "rejected", "openToken refuses a ciphertext moved to another user");

const otherRow = await openToken(
  key,
  table,
  "bbbbbbbb-0000-4000-8000-000000000001",
  user,
  sealed!.enc,
  sealed!.iv,
  sealed!.keyVersion,
).then(
  () => "opened",
  () => "rejected",
);
ok(otherRow === "rejected", "openToken refuses a ciphertext moved to another row");

const missing = await openToken(key, table, row, user, null, null, 1);
ok(missing === null, "openToken: missing columns are null, not a throw");

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("secrets: ok");
