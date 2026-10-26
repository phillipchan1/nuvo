/**
 * Sealed tokens on Neon (PR A interface).
 *
 * Vault `store_secret / read_secret / delete_secret` become these two
 * helpers plus nullable `*_secret_id` columns kept for traceability.
 * AAD is `table:row_id:user_id` so a ciphertext cannot be moved onto
 * another row or another user.
 *
 * This PR (D) only *opens* calendar tokens. Seal/copy is PR A's job.
 * Never log plaintext, ciphertext, or AAD contents.
 */
const ENC_ALG = "AES-GCM";
const KEY_VERSION_V1 = 1;

export class TokenSealError extends Error {
  override name = "TokenSealError";
}

function decodeKey(raw: string | undefined): Uint8Array | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const bin = atob(trimmed.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length === 32 ? out : null;
  } catch {
    return null;
  }
}

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, ENC_ALG, false, ["encrypt", "decrypt"]);
}

function aadBytes(table: string, rowId: string, userId: string): Uint8Array {
  return new TextEncoder().encode(`${table}:${rowId}:${userId}`);
}

export function tokenKeyConfigured(keyB64: string | undefined): boolean {
  return decodeKey(keyB64) !== null;
}

export async function sealToken(
  keyB64: string | undefined,
  table: string,
  rowId: string,
  userId: string,
  plaintext: string,
): Promise<{ enc: Uint8Array; iv: Uint8Array; keyVersion: number } | null> {
  const raw = decodeKey(keyB64);
  if (!raw) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(raw);
  const enc = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: ENC_ALG, iv, additionalData: aadBytes(table, rowId, userId) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return { enc, iv, keyVersion: KEY_VERSION_V1 };
}

export async function openToken(
  keyB64: string | undefined,
  table: string,
  rowId: string,
  userId: string,
  enc: Uint8Array | ArrayBuffer | null | undefined,
  iv: Uint8Array | ArrayBuffer | null | undefined,
  keyVersion: number | null | undefined,
): Promise<string | null> {
  if (!enc || !iv) return null;
  if (keyVersion != null && keyVersion !== KEY_VERSION_V1) return null;
  const raw = decodeKey(keyB64);
  if (!raw) return null;
  const key = await importKey(raw);
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: ENC_ALG,
        iv: iv instanceof Uint8Array ? iv : new Uint8Array(iv),
        additionalData: aadBytes(table, rowId, userId),
      },
      key,
      enc instanceof Uint8Array ? enc : new Uint8Array(enc),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new TokenSealError("token open failed");
  }
}
