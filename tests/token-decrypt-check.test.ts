import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTokenKeyring, sealToken } from "../worker/src/secrets.ts";
import {
  SEALED_TOKENS_SQL,
  EXPECTED_TOKENS_SQL,
  checkTokenRows,
  readTokenKey,
  runTokenDecryptCheck,
  usesNeonHttp,
  type TokenRow,
} from "../worker/src/tokenDecrypt.check.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const ROW = "aaaaaaaa-eeee-4000-8000-000000000001";
const KEY = "00".repeat(32);

async function sealedRow(
  secret: string,
  provider: string,
  table: TokenRow["table_name"] = "calendar_accounts",
): Promise<TokenRow> {
  const ring = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: KEY });
  const sealed = await sealToken(secret, { table, rowId: ROW, userId: USER }, ring);
  return {
    table_name: table,
    provider,
    row_id: ROW,
    user_id: USER,
    enc: sealed.ciphertext,
    iv: sealed.iv,
    key_version: sealed.keyVersion,
  };
}

describe("tokenDecrypt.check query shape", () => {
  it("casts enum (and UNION) columns to text so 42804 cannot fire", () => {
    expect(SEALED_TOKENS_SQL).toMatch(/provider::text/);
    expect(SEALED_TOKENS_SQL).toMatch(/kind::text/);
    expect(SEALED_TOKENS_SQL).toMatch(/'apple'::text/);
    expect(SEALED_TOKENS_SQL).not.toMatch(/table_name,\s*provider,/);
    expect(SEALED_TOKENS_SQL).toMatch(/UNION ALL/);
    expect(EXPECTED_TOKENS_SQL).toMatch(/provider::text/);
    expect(EXPECTED_TOKENS_SQL).toMatch(/kind::text/);
    expect(EXPECTED_TOKENS_SQL).toMatch(/'apple'::text/);
    // Only rows that carried a Vault token owe a sealed one.
    expect(EXPECTED_TOKENS_SQL.match(/secret_id IS NOT NULL/g)).toHaveLength(3);
  });

  it("uses Neon HTTPS unless TOKEN_DECRYPT_TCP=1", () => {
    const neon = "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo_dryrun_scratch";
    expect(usesNeonHttp(neon)).toBe(true);
    expect(usesNeonHttp(neon, true)).toBe(false);
    expect(usesNeonHttp("postgresql://postgres@127.0.0.1:5432/nuvo")).toBe(false);
  });
});

describe("tokenDecrypt.check decrypt pass/fail", () => {
  it("prints provider ok when every sealed token opens", async () => {
    const ring = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: KEY });
    const google = await sealedRow("1//google-refresh-token-value", "google");
    const result = await checkTokenRows([google], { google: 1 }, ring);
    expect(result.lines).toEqual(["google ok"]);
    expect(result.failed).toBe(0);
    expect(result.checked.google).toBe(1);
  });

  it("fails when a sealed token does not decrypt", async () => {
    const ring = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: KEY });
    const other = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: "11".repeat(32) });
    const google = await sealedRow("1//google-refresh-token-value", "google");
    const result = await checkTokenRows([google], { google: 1 }, other);
    expect(result.lines).toEqual(["google fail"]);
    expect(result.failed).toBe(1);
  });

  it("fails when a provider owes tokens but 0 were checked", async () => {
    const ring = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: KEY });
    const result = await checkTokenRows([], { google: 1 }, ring);
    expect(result.lines).toEqual(["google fail"]);
    expect(result.failed).toBe(1);
    expect(result.checked).toEqual({});
  });

  it("decrypts every sealed row, not one per provider", async () => {
    const ring = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: KEY });
    const good = await sealedRow("1//google-refresh-token-value", "google");
    const bad: TokenRow = { ...good, enc: new Uint8Array(good.enc as Uint8Array) };
    (bad.enc as Uint8Array)[0] ^= 0xff;
    const result = await checkTokenRows([good, bad], { google: 2 }, ring);
    expect(result.checked.google).toBe(2);
    expect(result.lines).toEqual(["google fail"]);
    expect(result.failed).toBe(1);
  });

  it("fails when fewer tokens open than had a Vault pointer", async () => {
    const ring = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: KEY });
    const google = await sealedRow("1//google-refresh-token-value", "google");
    const result = await checkTokenRows([google], { google: 2 }, ring);
    expect(result.lines).toEqual(["google fail"]);
    expect(result.failed).toBe(1);
  });

  it("passes when a provider's rows never had a token to seal", async () => {
    // Prod 2026-10-29: two Apple identities from ID-token-only sign-in, no Vault pointer.
    const ring = await parseTokenKeyring({ TOKEN_ENC_KEY_V1: KEY });
    const google = await sealedRow("1//google-refresh-token-value", "google");
    const result = await checkTokenRows([google], { google: 1 }, ring);
    expect(result.lines).toEqual(["google ok"]);
    expect(result.failed).toBe(0);
  });

  it("reads the key from a file path and never returns env when the file is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "token-key-"));
    const file = join(dir, "nuvo-token-enc-key-v1");
    writeFileSync(file, `${KEY}\n`);
    expect(readTokenKey({ TOKEN_ENC_KEY_V1_FILE: file, TOKEN_ENC_KEY_V1: "should-not-win" })).toBe(KEY);
  });

  it("runs against a mock DB (no network) and fails a provider that owes tokens but has 0", async () => {
    const seen: string[] = [];
    const code = await runTokenDecryptCheck(
      { TOKEN_ENC_KEY_V1: KEY, DATABASE_URL: "postgresql://mock" },
      async () => ({
        query: async (text) => {
          seen.push(text);
          if (text.includes("refresh_token_enc")) return [];
          return [{ provider: "google", n: 1 }];
        },
      }),
    );
    expect(code).toBe(1);
    expect(seen.some((q) => /provider::text/.test(q))).toBe(true);
    expect(seen.some((q) => q === SEALED_TOKENS_SQL)).toBe(true);
    expect(seen.some((q) => q === EXPECTED_TOKENS_SQL)).toBe(true);
  });
});
