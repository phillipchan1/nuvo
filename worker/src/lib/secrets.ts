/**
 * PR A contract — AES-256-GCM seal/open for provider tokens.
 *
 * AAD is `table:row_id:user_id` so a ciphertext cannot be moved onto
 * another row or user. Worker secret: `TOKEN_ENC_KEY_V1` (32 bytes:
 * 64-char hex, standard base64, or raw UTF-8).
 *
 * github-activity uses this for GitHub PATs (`activity_sources`).
 * PR A owns the canonical module; keep this signature stable.
 */

export const TOKEN_KEY_VERSION = 1;
const IV_BYTES = 12;

export type TokenTable = "activity_sources" | "calendar_accounts" | "apple_identities";

export function tokenAad(table: TokenTable, rowId: string, userId: string): string {
  return `${table}:${rowId}:${userId}`;
}

export interface SealedToken {
  enc: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
}

export class TokenKeyError extends Error {
  override name = "TokenKeyError";
}

export function parseTokenKeyBytes(raw: string | undefined): Uint8Array {
  if (!raw?.trim()) throw new TokenKeyError("TOKEN_ENC_KEY_V1 is not configured");
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return hexToBytes(trimmed);
  try {
    const bin = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
    if (bin.length === 32) return bin;
  } catch {
    // not base64
  }
  const utf8 = new TextEncoder().encode(trimmed);
  if (utf8.length === 32) return utf8;
  throw new TokenKeyError("TOKEN_ENC_KEY_V1 must be 32 bytes");
}

export async function importTokenKey(raw: string | undefined): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", parseTokenKeyBytes(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealToken(key: CryptoKey, plaintext: string, aad: string): Promise<SealedToken> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { enc: new Uint8Array(buf), iv, keyVersion: TOKEN_KEY_VERSION };
}

export async function openToken(key: CryptoKey, sealed: SealedToken, aad: string): Promise<string> {
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv, additionalData: new TextEncoder().encode(aad) },
    key,
    sealed.enc,
  );
  return new TextDecoder().decode(buf);
}

/** Prefix/length only — never log the token. Fine-grained, classic, or OAuth. */
export function githubTokenShapeOk(token: string): boolean {
  return /^(ghp_|github_pat_|gho_|ghu_|ghs_)/.test(token) && token.length >= 20;
}

export function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string" && value.startsWith("\\x")) return hexToBytes(value.slice(2));
  return null;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
