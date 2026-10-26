/**
 * AES-256-GCM token seal for Neon columns.
 *
 * Replaces Vault `store_secret` / `read_secret` / `delete_secret` on the
 * Worker. AAD is length-prefixed `table`, `row_id`, `user_id` (UUIDs
 * validated) so a ciphertext cannot be moved onto another row or user.
 * Keys live in Worker secrets
 * (`TOKEN_ENC_KEY_V1`, optional `TOKEN_ENC_KEY_V2`, `TOKEN_ENC_CURRENT`).
 *
 * Delete = null the enc/iv/version columns. Never log plaintext or key bytes.
 */

export const TOKEN_KEY_VERSION_V1 = 1;
export const TOKEN_KEY_VERSION_V2 = 2;
export const AES_KEY_BYTES = 32;
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BITS = 128;

export const TOKEN_TABLES = ["calendar_accounts", "activity_sources", "apple_identities"] as const;
export type TokenTable = (typeof TOKEN_TABLES)[number];

export interface TokenAad {
  table: TokenTable | string;
  rowId: string;
  userId: string;
}

export interface SealedToken {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
}

export interface TokenKeyring {
  current: { version: number; key: CryptoKey };
  byVersion: Map<number, CryptoKey>;
}

export class TokenCryptoError extends Error {
  override name = "TokenCryptoError";
  constructor(message = "token crypto failed") {
    super(message);
  }
}

const HEX32 = /^[0-9a-f]{64}$/i;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 32-byte AES-256 key from hex (64 chars) or standard base64. */
export function parseRawKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new TokenCryptoError("token key missing");
  if (HEX32.test(trimmed)) return hexToBytes(trimmed);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(trimmed);
  } catch {
    throw new TokenCryptoError("token key is not hex or base64");
  }
  if (bytes.length !== AES_KEY_BYTES) throw new TokenCryptoError("token key must be 32 bytes");
  return bytes;
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== AES_KEY_BYTES) throw new TokenCryptoError("token key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidField(value: string, label: string): string {
  const trimmed = value.trim();
  if (!UUID_RE.test(trimmed)) throw new TokenCryptoError(`${label} must be a uuid`);
  return trimmed;
}

function lengthPrefixed(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 0xffff) throw new TokenCryptoError("AAD field too long");
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

export function tokenAadString(aad: TokenAad): string {
  const table = aad.table.trim();
  if (!table) throw new TokenCryptoError("AAD table required");
  const rowId = requireUuidField(aad.rowId, "AAD row");
  const userId = requireUuidField(aad.userId, "AAD user");
  return `${table}:${rowId}:${userId}`;
}

export function tokenAadBytes(aad: TokenAad): Uint8Array {
  const table = aad.table.trim();
  if (!table) throw new TokenCryptoError("AAD table required");
  const rowId = requireUuidField(aad.rowId, "AAD row");
  const userId = requireUuidField(aad.userId, "AAD user");
  const parts = [lengthPrefixed(table), lengthPrefixed(rowId), lengthPrefixed(userId)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function parseVersion(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? "").trim() || String(fallback), 10);
  if (n !== TOKEN_KEY_VERSION_V1 && n !== TOKEN_KEY_VERSION_V2) {
    throw new TokenCryptoError("unknown token key version");
  }
  return n;
}

export interface TokenKeyEnv {
  TOKEN_ENC_KEY_V1?: string;
  TOKEN_ENC_KEY_V2?: string;
  TOKEN_ENC_CURRENT?: string;
}

export async function parseTokenKeyring(env: TokenKeyEnv): Promise<TokenKeyring> {
  const v1raw = env.TOKEN_ENC_KEY_V1?.trim() ?? "";
  if (!v1raw) throw new TokenCryptoError("TOKEN_ENC_KEY_V1 missing");
  const currentVersion = parseVersion(env.TOKEN_ENC_CURRENT, TOKEN_KEY_VERSION_V1);
  const byVersion = new Map<number, CryptoKey>();
  byVersion.set(TOKEN_KEY_VERSION_V1, await importAesKey(parseRawKey(v1raw)));
  const v2raw = env.TOKEN_ENC_KEY_V2?.trim() ?? "";
  if (v2raw) {
    byVersion.set(TOKEN_KEY_VERSION_V2, await importAesKey(parseRawKey(v2raw)));
  }
  const currentKey = byVersion.get(currentVersion);
  if (!currentKey) throw new TokenCryptoError("current token key is not configured");
  return { current: { version: currentVersion, key: currentKey }, byVersion };
}

export async function sealToken(
  plaintext: string,
  aad: TokenAad,
  keyring: TokenKeyring,
): Promise<SealedToken> {
  if (typeof plaintext !== "string") throw new TokenCryptoError("plaintext required");
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: tokenAadBytes(aad), tagLength: GCM_TAG_BITS },
      keyring.current.key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return { ciphertext, iv, keyVersion: keyring.current.version };
}

export async function openToken(
  sealed: SealedToken,
  aad: TokenAad,
  keyring: TokenKeyring,
): Promise<string> {
  const key = keyring.byVersion.get(sealed.keyVersion);
  if (!key) throw new TokenCryptoError("unknown key version");
  if (sealed.iv.length !== GCM_IV_BYTES) throw new TokenCryptoError("invalid iv");
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv, additionalData: tokenAadBytes(aad), tagLength: GCM_TAG_BITS },
      key,
      sealed.ciphertext,
    );
  } catch {
    throw new TokenCryptoError("decrypt failed");
  }
  return new TextDecoder().decode(plaintext);
}

/** Delete = clear the sealed columns. The *_secret_id pointer is left alone. */
export function clearedTokenColumns(): {
  refresh_token_enc: null;
  refresh_token_iv: null;
  key_version: null;
} {
  return { refresh_token_enc: null, refresh_token_iv: null, key_version: null };
}

export function sealedColumnValues(sealed: SealedToken): {
  refresh_token_enc: Uint8Array;
  refresh_token_iv: Uint8Array;
  key_version: number;
} {
  return {
    refresh_token_enc: sealed.ciphertext,
    refresh_token_iv: sealed.iv,
    key_version: sealed.keyVersion,
  };
}

/** Hex form for the copy job's parameterized UPDATE (psql bytea). */
export function sealedToHex(sealed: SealedToken): { encHex: string; ivHex: string; keyVersion: number } {
  return {
    encHex: bytesToHex(sealed.ciphertext),
    ivHex: bytesToHex(sealed.iv),
    keyVersion: sealed.keyVersion,
  };
}
