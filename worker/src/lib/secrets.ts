/**
 * Token seal/open stub (PR A owns the production version).
 *
 * AAD binds a ciphertext to `table:row_id:user_id` so it cannot be moved.
 * Unset `TOKEN_ENC_KEY_V1` → null (caller stores on the Better Auth account
 * row instead). Never logs plaintext.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;

function decodeKey(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const bin = atob(trimmed);
    if (bin.length !== KEY_BYTES) return null;
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importAes(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealToken(
  keyB64: string | undefined,
  plaintext: string,
  aad: string,
): Promise<{ enc: Uint8Array; iv: Uint8Array; keyVersion: number } | null> {
  const raw = decodeKey(keyB64 ?? "");
  if (!raw || !plaintext) return null;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await importAes(raw);
  const enc = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return { enc, iv, keyVersion: 1 };
}

export async function openToken(
  keyB64: string | undefined,
  enc: Uint8Array,
  iv: Uint8Array,
  aad: string,
): Promise<string | null> {
  const raw = decodeKey(keyB64 ?? "");
  if (!raw || !enc.length || !iv.length) return null;
  try {
    const key = await importAes(raw);
    const dec = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
      key,
      enc,
    );
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}
