// Run: node --experimental-strip-types worker/src/passwordHash.check.ts
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { hashPassword } from "better-auth/crypto";
import { isBcryptHash, verifyPassword } from "./passwordHash.ts";

const pw = "correct horse battery";
const wrong = "wrong horse battery";

// Legacy bcrypt (as copied from Supabase auth.users.encrypted_password).
const b = await bcrypt.hash(pw, 4);
assert.ok(isBcryptHash(b), "bcryptjs hash is recognised");
assert.equal(await verifyPassword({ hash: b, password: pw }), true, "bcrypt: right password");
assert.equal(await verifyPassword({ hash: b, password: wrong }), false, "bcrypt: wrong password");

const a = b.replace(/^\$2b\$/, "$2a$");
assert.ok(a.startsWith("$2a$") && isBcryptHash(a), "$2a$ hash is recognised");
assert.equal(await verifyPassword({ hash: a, password: pw }), true, "$2a$: right password");
assert.equal(await verifyPassword({ hash: a, password: wrong }), false, "$2a$: wrong password");

// Better Auth's native scrypt.
const s = await hashPassword(pw);
assert.ok(!isBcryptHash(s), "scrypt hash is not bcrypt");
assert.equal(await verifyPassword({ hash: s, password: pw }), true, "scrypt: right password");
assert.equal(await verifyPassword({ hash: s, password: wrong }), false, "scrypt: wrong password");

// Garbage never throws.
for (const hash of ["", "garbage", "$2a$10$short", "$2b$04$" + "!".repeat(53)]) {
  let got: boolean | undefined;
  await assert.doesNotReject(async () => {
    got = await verifyPassword({ hash, password: pw });
  }, `garbage ${JSON.stringify(hash)} does not throw`);
  assert.equal(got, false, `garbage ${JSON.stringify(hash)} is false`);
}

console.log("passwordHash: ok");
