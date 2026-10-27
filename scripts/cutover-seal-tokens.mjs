#!/usr/bin/env node
/**
 * Stream Vault plaintext from migration_tmp.vault_tokens(), seal with
 * TOKEN_ENC_KEY_V1, UPDATE Neon. Then seal+NULL any leftover plaintext
 * calendar_accounts.access_token copied from the dump. Counts only. No
 * files, no artifacts, no logging of secrets or ciphertext.
 *
 * This script never applies vault_tokens.sql.
 */
import postgres from "postgres";
import { parseTokenKeyring, sealToken, sealedColumnValues } from "../worker/src/secrets.ts";

const SOURCE = (process.env.SOURCE_DATABASE_URL || "").trim();
const TARGET = (process.env.RESTORE_DATABASE_URL || process.env.TARGET_DATABASE_URL || "").trim();
const KEY = (process.env.TOKEN_ENC_KEY_V1 || "").trim();

function mask(value) {
  if (!value) return;
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${value}`);
  }
}

function die(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

mask(SOURCE);
mask(TARGET);
mask(KEY);
if (process.env.TOKEN_ENC_KEY_V2) mask(process.env.TOKEN_ENC_KEY_V2.trim());

if (!SOURCE) die("Missing SOURCE_DATABASE_URL");
if (!TARGET) die("Missing RESTORE_DATABASE_URL");
if (!KEY) die("Missing repo secret TOKEN_ENC_KEY_V1");
if (SOURCE === TARGET) die("Source and target URLs must be different");

const TABLES = {
  calendar_accounts: { key: "id" },
  apple_identities: { key: "user_id" },
  activity_sources: { key: "id" },
};

function sslFor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
      return false;
    }
  } catch {
    /* ignore */
  }
  return "require";
}

const source = postgres(SOURCE, {
  max: 1,
  ssl: sslFor(SOURCE),
  connection: { options: "-c default_transaction_read_only=on" },
});
const target = postgres(TARGET, { max: 1, ssl: sslFor(TARGET) });

const counts = {
  calendar_accounts: { source: 0, encrypted: 0, mismatches: 0 },
  apple_identities: { source: 0, encrypted: 0, mismatches: 0 },
  activity_sources: { source: 0, encrypted: 0, mismatches: 0 },
};

try {
  const ring = await parseTokenKeyring({
    TOKEN_ENC_KEY_V1: KEY,
    TOKEN_ENC_KEY_V2: process.env.TOKEN_ENC_KEY_V2,
    TOKEN_ENC_CURRENT: process.env.TOKEN_ENC_CURRENT,
  });

  const present = await source`
    SELECT to_regprocedure('migration_tmp.vault_tokens()') IS NOT NULL AS ok
  `;
  if (!present[0]?.ok) {
    die(
      "migration_tmp.vault_tokens() is missing. Apply docs/cloudflare-migration/vault_tokens.sql (Phil/TL) and re-run. This job does not apply it.",
    );
  }

  await target.unsafe(`
    ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS refresh_token_enc BYTEA;
    ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS refresh_token_iv BYTEA;
    ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS access_token_enc BYTEA;
    ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS access_token_iv BYTEA;
    ALTER TABLE public.calendar_accounts ADD COLUMN IF NOT EXISTS key_version SMALLINT;
    ALTER TABLE public.activity_sources ADD COLUMN IF NOT EXISTS refresh_token_enc BYTEA;
    ALTER TABLE public.activity_sources ADD COLUMN IF NOT EXISTS refresh_token_iv BYTEA;
    ALTER TABLE public.activity_sources ADD COLUMN IF NOT EXISTS key_version SMALLINT;
    ALTER TABLE public.apple_identities ADD COLUMN IF NOT EXISTS refresh_token_enc BYTEA;
    ALTER TABLE public.apple_identities ADD COLUMN IF NOT EXISTS refresh_token_iv BYTEA;
    ALTER TABLE public.apple_identities ADD COLUMN IF NOT EXISTS key_version SMALLINT;
  `);

  const cursor = source.unsafe("SELECT table_name, row_id, user_id, secret FROM migration_tmp.vault_tokens()").cursor(50);
  for await (const batch of cursor) {
    for (const row of batch) {
      const table = String(row.table_name || "");
      const spec = TABLES[table];
      if (!spec) {
        counts.calendar_accounts.mismatches += 1;
        continue;
      }
      counts[table].source += 1;
      const secret = typeof row.secret === "string" ? row.secret : "";
      if (!secret || !row.row_id || !row.user_id) {
        counts[table].mismatches += 1;
        continue;
      }
      const sealed = await sealToken(secret, { table, rowId: String(row.row_id), userId: String(row.user_id) }, ring);
      const cols = sealedColumnValues(sealed);
      const updated =
        table === "apple_identities"
          ? await target`
              UPDATE apple_identities
              SET refresh_token_enc = ${cols.refresh_token_enc},
                  refresh_token_iv = ${cols.refresh_token_iv},
                  key_version = ${cols.key_version}
              WHERE user_id = ${row.row_id}::uuid
                AND user_id = ${row.user_id}::uuid
              RETURNING user_id
            `
          : table === "activity_sources"
            ? await target`
                UPDATE activity_sources
                SET refresh_token_enc = ${cols.refresh_token_enc},
                    refresh_token_iv = ${cols.refresh_token_iv},
                    key_version = ${cols.key_version}
                WHERE id = ${row.row_id}::uuid
                  AND user_id = ${row.user_id}::uuid
                RETURNING id
              `
            : await target`
                UPDATE calendar_accounts
                SET refresh_token_enc = ${cols.refresh_token_enc},
                    refresh_token_iv = ${cols.refresh_token_iv},
                    key_version = ${cols.key_version}
                WHERE id = ${row.row_id}::uuid
                  AND user_id = ${row.user_id}::uuid
                RETURNING id
              `;
      if (updated.length === 1) counts[table].encrypted += 1;
      else counts[table].mismatches += 1;
    }
  }

  let mismatches = 0;
  for (const [table, n] of Object.entries(counts)) {
    if (n.source !== n.encrypted || n.mismatches !== 0) mismatches += 1;
    console.log(`${table}: source=${n.source} encrypted=${n.encrypted} mismatches=${n.mismatches}`);
  }
  if (mismatches) die("token copy mismatches — abort");

  // Plaintext access_token is copied from Supabase. Seal it (same AAD as
  // the live Worker), then NULL the column. Counts only — never print values.
  const accessRows = await target`
    SELECT id, user_id, access_token
    FROM calendar_accounts
    WHERE access_token IS NOT NULL AND btrim(access_token) <> ''
  `;
  let accessSealed = 0;
  for (const row of accessRows) {
    const secret = typeof row.access_token === "string" ? row.access_token : "";
    if (!secret || !row.id || !row.user_id) continue;
    const sealed = await sealToken(
      secret,
      { table: "calendar_accounts", rowId: String(row.id), userId: String(row.user_id) },
      ring,
    );
    const updated = await target`
      UPDATE calendar_accounts
      SET access_token_enc = ${sealed.ciphertext},
          access_token_iv = ${sealed.iv},
          access_token = NULL,
          key_version = COALESCE(key_version, ${sealed.keyVersion})
      WHERE id = ${row.id}::uuid
        AND user_id = ${row.user_id}::uuid
      RETURNING id
    `;
    if (updated.length === 1) accessSealed += 1;
  }
  await target`
    UPDATE calendar_accounts
    SET access_token = NULL
    WHERE access_token IS NOT NULL AND btrim(access_token) = ''
  `;
  const leftover = await target`
    SELECT count(*)::int AS n
    FROM calendar_accounts
    WHERE access_token IS NOT NULL AND btrim(access_token) <> ''
  `;
  const leftoverN = leftover[0]?.n ?? 0;
  console.log(`calendar_accounts access_token: sealed=${accessSealed} leftover=${leftoverN}`);
  if (leftoverN > 0) die("plaintext access_token remains — abort");
  console.log("token copy ok");
} finally {
  await Promise.allSettled([source.end({ timeout: 5 }), target.end({ timeout: 5 })]);
}
