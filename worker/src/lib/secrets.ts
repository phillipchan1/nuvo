/**
 * Sealed refresh tokens / app passwords / ICS feed URLs.
 *
 * PR A interface. AES-256-GCM via WebCrypto. AAD binds the ciphertext to
 * `table:row_id:user_id` so a blob cannot be moved onto another row or user.
 * Delete = null the enc/iv/version columns.
 */
export const TOKEN_KEY_VERSION = 1;
export type TokenTable = "calendar_accounts" | "apple_identities" | "activity_sources";

export interface SealedToken {
  enc: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
}

export function tokenAad(table: TokenTable, rowId: string, userId: string): string {
  return `${table}:${rowId}:${userId}`;
}

function decodeKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("TOKEN_ENC_KEY_V1 is not set");
  let bytes: Uint8Array;
  try {
    const bin = atob(trimmed);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    throw new Error("TOKEN_ENC_KEY_V1 is not valid base64");
  }
  if (bytes.byteLength !== 32) throw new Error("TOKEN_ENC_KEY_V1 must be 32 bytes");
  return bytes;
}

async function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeKey(raw) as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealToken(key: string, plaintext: string, aad: string): Promise<SealedToken> {
  if (!plaintext) throw new Error("cannot seal an empty token");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    await importKey(key),
    new TextEncoder().encode(plaintext),
  );
  return { enc: new Uint8Array(buf), iv, keyVersion: TOKEN_KEY_VERSION };
}

export async function openToken(key: string, sealed: SealedToken, aad: string): Promise<string> {
  if (!sealed.enc?.byteLength || !sealed.iv?.byteLength) throw new Error("sealed token is empty");
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as BufferSource, additionalData: new TextEncoder().encode(aad) },
    await importKey(key),
    sealed.enc as BufferSource,
  );
  return new TextDecoder().decode(buf);
}

/** Fixture key for checks. Never a production secret. */
export function testTokenKey(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}
