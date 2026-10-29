/**
 * Post-copy Neon check. Opens every sealed token and prints `provider ok`
 * / `provider fail` only. Never prints tokens, the key, emails, or row ids.
 *
 * Reads the key from TOKEN_ENC_KEY_V1_FILE (preferred) or TOKEN_ENC_KEY_V1.
 * Skips (exit 0) only when both the key and DATABASE_URL are unset — CI
 * does not have migrated tokens. A provider that opens fewer tokens than it
 * had Vault pointers at the source is a no-go (exit 1).
 *
 * Neon URLs use @neondatabase/serverless over HTTPS. TOKEN_DECRYPT_TCP=1
 * forces the TCP postgres.js driver.
 *
 * Run: TOKEN_ENC_KEY_V1_FILE=… DATABASE_URL=… node --experimental-strip-types worker/src/tokenDecrypt.check.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { postgresSsl } from "./db.ts";
import { openToken, parseTokenKeyring, type TokenKeyring, type TokenTable } from "./secrets.ts";

export type TokenRow = {
  table_name: TokenTable;
  provider: string;
  row_id: string;
  user_id: string;
  enc: Uint8Array | Buffer | string;
  iv: Uint8Array | Buffer | string;
  key_version: number;
};

/** Enum columns in this UNION must be `::text` or Postgres raises 42804. */
export const SEALED_TOKENS_SQL = `
  SELECT * FROM (
    SELECT 'calendar_accounts'::text AS table_name, provider::text AS provider, id::text AS row_id, user_id::text,
           refresh_token_enc AS enc, refresh_token_iv AS iv, key_version
    FROM calendar_accounts
    WHERE refresh_token_enc IS NOT NULL
    UNION ALL
    SELECT 'activity_sources'::text, kind::text, id::text, user_id::text,
           refresh_token_enc, refresh_token_iv, key_version
    FROM activity_sources
    WHERE refresh_token_enc IS NOT NULL
    UNION ALL
    SELECT 'apple_identities'::text, 'apple'::text, user_id::text, user_id::text,
           refresh_token_enc, refresh_token_iv, key_version
    FROM apple_identities
    WHERE refresh_token_enc IS NOT NULL
  ) t
`;

/**
 * How many sealed tokens each provider owes: one per row that carried a Vault
 * token at the source. A row without a Vault pointer never had a token to seal
 * (an Apple identity from ID-token-only sign-in, a Google account that never
 * granted offline access), so it isn't counted.
 */
export const EXPECTED_TOKENS_SQL = `
  SELECT provider, count(*)::int AS n FROM (
    SELECT provider::text AS provider FROM calendar_accounts
    WHERE refresh_token_secret_id IS NOT NULL
    UNION ALL
    SELECT kind::text FROM activity_sources
    WHERE token_secret_id IS NOT NULL
    UNION ALL
    SELECT 'apple'::text FROM apple_identities
    WHERE refresh_token_secret_id IS NOT NULL
  ) p
  GROUP BY provider
`;

export function usesNeonHttp(url: string, forceTcp = false): boolean {
  if (forceTcp) return false;
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "neon.tech" || host.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

export function readTokenKey(env: NodeJS.Dict<string> = process.env): string {
  const file = (env.TOKEN_ENC_KEY_V1_FILE ?? "").trim();
  if (file) return readFileSync(file, "utf8").trim();
  return (env.TOKEN_ENC_KEY_V1 ?? "").trim();
}

export function asBytes(value: Uint8Array | Buffer | string): Uint8Array {
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

export type TokenCheckResult = {
  lines: string[];
  failed: number;
  checked: Record<string, number>;
};

/** Decrypt every sealed row. A provider that opens fewer tokens than it owes is a fail. */
export async function checkTokenRows(
  rows: TokenRow[],
  expected: Record<string, number>,
  ring: TokenKeyring,
): Promise<TokenCheckResult> {
  const checked: Record<string, number> = {};
  const fails = new Set<string>();
  for (const row of rows) {
    const provider = String(row.provider ?? "");
    if (!provider) continue;
    checked[provider] = (checked[provider] ?? 0) + 1;
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
        fails.add(provider);
        continue;
      }
      void prefixClass(secret);
    } catch {
      fails.add(provider);
    }
  }

  const names = [...new Set([...Object.keys(expected), ...Object.keys(checked)])].sort();
  const lines: string[] = [];
  let failed = 0;
  if (names.length === 0) {
    return { lines, failed: 1, checked };
  }
  for (const name of names) {
    const n = checked[name] ?? 0;
    if (n > 0 && n >= (expected[name] ?? 0) && !fails.has(name)) {
      lines.push(`${name} ok`);
    } else {
      lines.push(`${name} fail`);
      failed += 1;
    }
  }
  return { lines, failed, checked };
}

type SqlQuery = {
  query(text: string): Promise<Record<string, unknown>[]>;
  end?: () => Promise<void>;
};

export async function openTokenCheckSql(url: string, forceTcp = false): Promise<SqlQuery> {
  if (usesNeonHttp(url, forceTcp)) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    return {
      query: async (text) => (await sql.query(text)) as Record<string, unknown>[],
    };
  }
  const sql = postgres(url, { max: 1, ssl: postgresSsl(url) });
  return {
    query: async (text) => (await sql.unsafe(text)) as unknown as Record<string, unknown>[],
    end: () => sql.end({ timeout: 5 }),
  };
}

function asTokenRow(row: Record<string, unknown>): TokenRow {
  return {
    table_name: row.table_name as TokenTable,
    provider: String(row.provider ?? ""),
    row_id: String(row.row_id ?? ""),
    user_id: String(row.user_id ?? ""),
    enc: row.enc as TokenRow["enc"],
    iv: row.iv as TokenRow["iv"],
    key_version: Number(row.key_version),
  };
}

export async function runTokenDecryptCheck(
  env: NodeJS.Dict<string> = process.env,
  openSql: typeof openTokenCheckSql = openTokenCheckSql,
): Promise<number> {
  let key = "";
  try {
    key = readTokenKey(env);
  } catch {
    console.error("tokenDecrypt: failed to read key file");
    return 1;
  }
  const dbUrl = (env.TOKEN_DECRYPT_DATABASE_URL ?? env.DATABASE_URL ?? "").trim();
  if (!key || !dbUrl) {
    console.log("tokenDecrypt: skipped (TOKEN_ENC_KEY_V1 + DATABASE_URL unset)");
    return 0;
  }

  let ring: TokenKeyring;
  try {
    ring = await parseTokenKeyring({
      TOKEN_ENC_KEY_V1: key,
      TOKEN_ENC_KEY_V2: env.TOKEN_ENC_KEY_V2,
      TOKEN_ENC_CURRENT: env.TOKEN_ENC_CURRENT,
    });
  } catch {
    console.error("tokenDecrypt: key rejected");
    return 1;
  }

  const forceTcp = (env.TOKEN_DECRYPT_TCP ?? "").trim() === "1";
  const sql = await openSql(dbUrl, forceTcp);
  try {
    const rawRows = await sql.query(SEALED_TOKENS_SQL);
    const rawExpected = await sql.query(EXPECTED_TOKENS_SQL);
    const rows = rawRows.map(asTokenRow);
    const expected: Record<string, number> = {};
    for (const r of rawExpected) {
      const provider = String(r.provider ?? "");
      if (provider) expected[provider] = Number(r.n ?? 0);
    }
    const result = await checkTokenRows(rows, expected, ring);
    for (const line of result.lines) console.log(line);
    return result.failed ? 1 : 0;
  } catch {
    console.error("tokenDecrypt: query failed");
    return 1;
  } finally {
    await sql.end?.();
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === resolve(entry);
}

if (isMainModule() && !process.env.VITEST) {
  process.exit(await runTokenDecryptCheck());
}
