/**
 * PR A token-crypto interface (sealed refresh tokens on Neon).
 *
 * AES-256-GCM via WebCrypto. AAD is `table:row_id:user_id` so a ciphertext
 * cannot be moved onto another row or user. Worker secret: `TOKEN_ENC_KEY_V1`
 * (32-byte key, base64 or hex).
 *
 * This file is the contract PR B (and later providers) call. If PR A's
 * implementation lands first, keep these names and the AAD format.
 */
export const TOKEN_KEY_VERSION = 1;

export type TokenAad = {
  table: string;
  rowId: string;
  userId: string;
};

export type SealedToken = {
  enc: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
};

export function tokenAad(aad: TokenAad): string {
  return `${aad.table}:${aad.rowId}:${aad.userId}`;
}

/** 32-byte key from base64 (standard / URL) or 64-char hex. */
export function decodeTokenKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("TOKEN_ENC_KEY_V1 is not set");
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const bin = atob(normalized + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out.length !== 32) throw new Error("TOKEN_ENC_KEY_V1 must be 32 bytes");
  return out;
}

async function importAesKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeTokenKey(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealToken(keyRaw: string, plaintext: string, aad: TokenAad): Promise<SealedToken> {
  const key = await importAesKey(keyRaw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(tokenAad(aad)) },
    key,
    enc.encode(plaintext),
  );
  return { enc: new Uint8Array(cipher), iv, keyVersion: TOKEN_KEY_VERSION };
}

export async function openToken(
  keyRaw: string,
  enc: Uint8Array,
  iv: Uint8Array,
  aad: TokenAad,
): Promise<string> {
  const key = await importAesKey(keyRaw);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(tokenAad(aad)) },
    key,
    enc,
  );
  return new TextDecoder().decode(plain);
}

/** Delete = null the sealed columns. */
export function clearedToken(): { enc: null; iv: null; keyVersion: null } {
  return { enc: null, iv: null, keyVersion: null };
}

export function bytesFromUnknown(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
  }
  return null;
}
