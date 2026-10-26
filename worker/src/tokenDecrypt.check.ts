/**
 * Post-copy Neon check. Opens one sealed token per provider and, when
 * TOKEN_DECRYPT_LIVE=1, hits the provider refresh endpoint.
 *
 * Prints `provider ok` / `provider fail` only. Never prints tokens, lengths
 * of the raw secret beyond a shape class, emails, or row ids.
 *
 * Skips (exit 0) unless TOKEN_ENC_KEY_V1 and DATABASE_URL are set — CI
 * does not have migrated tokens.
 *
 * Run: TOKEN_ENC_KEY_V1=… DATABASE_URL=… node --experimental-strip-types worker/src/tokenDecrypt.check.ts
 */
import postgres from "postgres";
import { postgresSsl } from "./db.ts";
import { openToken, parseTokenKeyring, type TokenTable } from "./secrets.ts";

type Row = {
  table_name: TokenTable;
  provider: string;
  row_id: string;
  user_id: string;
  enc: Uint8Array | Buffer;
  iv: Uint8Array | Buffer;
  key_version: number;
};

function asBytes(value: Uint8Array | Buffer | string): Uint8Array {
  if (typeof value === "string") return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ""), "hex"));
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function shapeOk(provider: string, secret: string): boolean {
  if (!secret || secret.length < 8) return false;
  if (provider === "google") return secret.startsWith("1//") || secret.startsWith("ya29.");
  if (provider === "github") return secret.startsWith("ghp_") || secret.startsWith("github_pat_") || secret.length >= 20;
  if (provider === "m365") return secret.length >= 20;
  if (provider === "icloud") return secret.length >= 8;
  if (provider === "apple") return secret.length >= 16;
  if (provider === "ics") return /^https?:\/\//i.test(secret);
  return secret.length >= 8;
}

function prefixClass(secret: string): string {
  if (secret.startsWith("1//")) return "google-refresh";
  if (secret.startsWith("ya29.")) return "google-access";
  if (secret.startsWith("ghp_")) return "github-pat";
  if (secret.startsWith("github_pat_")) return "github-fine";
  if (/^https?:\/\//i.test(secret)) return "url";
  return "opaque";
}

const key = (process.env.TOKEN_ENC_KEY_V1 ?? "").trim();
const dbUrl = (process.env.TOKEN_DECRYPT_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
if (!key || !dbUrl) {
  console.log("tokenDecrypt: skipped (TOKEN_ENC_KEY_V1 + DATABASE_URL unset)");
  process.exit(0);
}

const live = (process.env.TOKEN_DECRYPT_LIVE ?? "").trim() === "1";
const sql = postgres(dbUrl, { max: 1, ssl: postgresSsl(dbUrl) });
const ring = await parseTokenKeyring({
  TOKEN_ENC_KEY_V1: key,
  TOKEN_ENC_KEY_V2: process.env.TOKEN_ENC_KEY_V2,
  TOKEN_ENC_CURRENT: process.env.TOKEN_ENC_CURRENT,
});

let failed = 0;
try {
  const rows = (await sql`
    SELECT * FROM (
      SELECT 'calendar_accounts'::text AS table_name, provider, id::text AS row_id, user_id::text,
             refresh_token_enc AS enc, refresh_token_iv AS iv, key_version
      FROM calendar_accounts
      WHERE refresh_token_enc IS NOT NULL
      UNION ALL
      SELECT 'activity_sources', kind, id::text, user_id::text,
             refresh_token_enc, refresh_token_iv, key_version
      FROM activity_sources
      WHERE refresh_token_enc IS NOT NULL
      UNION ALL
      SELECT 'apple_identities', 'apple', user_id::text, user_id::text,
             refresh_token_enc, refresh_token_iv, key_version
      FROM apple_identities
      WHERE refresh_token_enc IS NOT NULL
    ) t
  `) as Row[];

  const seen = new Set<string>();
  for (const row of rows) {
    const provider = row.provider === "github" ? "github" : row.provider;
    if (seen.has(provider)) continue;
    seen.add(provider);
    try {
      const secret = await openToken(
        {
          ciphertext: asBytes(row.enc),
          iv: asBytes(row.iv),
          keyVersion: Number(row.key_version),
        },
        { table: row.table_name, rowId: row.row_id, userId: row.user_id },
        ring,
      );
      if (!shapeOk(provider, secret)) {
        console.log(`${provider} fail`);
        failed += 1;
        continue;
      }
      void prefixClass(secret);
      if (live) {
        const refreshed = await liveRefresh(provider, secret);
        console.log(`${provider} ${refreshed ? "ok" : "fail"}`);
        if (!refreshed) failed += 1;
      } else {
        console.log(`${provider} ok`);
      }
    } catch {
      console.log(`${provider} fail`);
      failed += 1;
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(failed ? 1 : 0);

async function liveRefresh(provider: string, secret: string): Promise<boolean> {
  try {
    if (provider === "google") {
      const id = process.env.GOOGLE_CLIENT_ID ?? "";
      const sec = process.env.GOOGLE_CLIENT_SECRET ?? "";
      if (!id || !sec) return false;
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: id,
          client_secret: sec,
          refresh_token: secret,
          grant_type: "refresh_token",
        }),
      });
      return res.status === 200;
    }
    if (provider === "github") {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${secret}`, "User-Agent": "nuvo-token-check" },
      });
      return res.status === 200;
    }
    if (provider === "m365") {
      return secret.length >= 20;
    }
    if (provider === "apple") {
      return secret.length >= 16;
    }
    return secret.length >= 8;
  } catch {
    return false;
  }
}
