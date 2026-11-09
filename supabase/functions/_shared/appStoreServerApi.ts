/**
 * App Store Server API — "Get Transaction Info", the server-side source of a
 * StoreKit transaction for clients that cannot hand us its JWS (Nuvo iOS 1.1).
 *
 * Shared by the Supabase `apple-iap` function and the Worker billing route.
 * Zero imports, WebCrypto + fetch only. The response's `signedTransactionInfo`
 * is NOT trusted on its own: the caller verifies it with `verifyAppleJws`
 * exactly like a JWS from the device.
 *
 * Auth: an ES256 JWT signed with an App Store Connect "In-App Purchase" key
 * (https://developer.apple.com/documentation/appstoreserverapi/generating-json-web-tokens-for-api-requests).
 *   APPLE_IAP_KEY_ID      — the key's id (JWT header `kid`)
 *   APPLE_IAP_ISSUER_ID   — the team's issuer id (JWT `iss`)
 *   APPLE_IAP_PRIVATE_KEY — the .p8 PEM (PKCS#8, P-256); literal `\n` allowed
 * All three or nothing — a partial set reads as "not configured" (fail closed).
 */

export const APP_STORE_API_HOSTS = {
  production: "https://api.storekit.itunes.apple.com",
  sandbox: "https://api.storekit-sandbox.itunes.apple.com",
} as const;

export interface AppStoreApiCredentials {
  keyId: string;
  issuerId: string;
  privateKey: string;
}

export class AppStoreApiError extends Error {
  override name = "AppStoreApiError";
}

export function appStoreApiCredentialsFrom(get: (key: string) => string | undefined): AppStoreApiCredentials | null {
  const keyId = get("APPLE_IAP_KEY_ID")?.trim();
  const issuerId = get("APPLE_IAP_ISSUER_ID")?.trim();
  const privateKey = get("APPLE_IAP_PRIVATE_KEY")?.trim();
  if (!keyId || !issuerId || !privateKey) return null;
  return { keyId, issuerId, privateKey };
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new AppStoreApiError("empty private key");
  let bin: string;
  try {
    bin = atob(body);
  } catch {
    throw new AppStoreApiError("private key is not base64");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The bearer token for one request burst. Apple caps `exp` at 60 minutes; 5 is plenty. */
export async function appStoreApiToken(
  creds: AppStoreApiCredentials,
  bundleId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(creds.privateKey) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    if (e instanceof AppStoreApiError) throw e;
    throw new AppStoreApiError("private key is not a P-256 PKCS#8 key");
  }
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: creds.keyId, typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({
    iss: creds.issuerId,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    aud: "appstoreconnect-v1",
    bid: bundleId,
  })));
  // WebCrypto's ECDSA output is already IEEE P1363 `r || s` — what JWS wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

export type TransactionLookup =
  | { kind: "found"; signedTransactionInfo: string }
  | { kind: "not_found" };

/** Apple's transaction ids are decimal strings; anything else never reaches a URL. */
export function isAppleTransactionId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,32}$/.test(value);
}

/**
 * Production first, then sandbox (Apple's documented order: a sandbox id is
 * a 404 in production). Throws `AppStoreApiError` on anything that is not a
 * clean answer — network failure, 401, 429, 5xx, a body without
 * `signedTransactionInfo` — so the caller fails closed and the client retries.
 */
export async function fetchSignedTransactionInfo(
  transactionId: string,
  creds: AppStoreApiCredentials,
  bundleId: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  nowSeconds?: number,
): Promise<TransactionLookup> {
  if (!isAppleTransactionId(transactionId)) throw new AppStoreApiError("bad transaction id");
  const token = await appStoreApiToken(creds, bundleId, nowSeconds);
  for (const host of [APP_STORE_API_HOSTS.production, APP_STORE_API_HOSTS.sandbox]) {
    let res: Response;
    try {
      res = await fetchImpl(`${host}/inApps/v1/transactions/${transactionId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppStoreApiError("App Store Server API unreachable");
    }
    if (res.status === 404) continue;
    if (!res.ok) throw new AppStoreApiError(`App Store Server API status ${res.status}`);
    const body = (await res.json().catch(() => null)) as { signedTransactionInfo?: unknown } | null;
    const signed = body?.signedTransactionInfo;
    if (typeof signed !== "string" || !signed) throw new AppStoreApiError("App Store Server API answered without a transaction");
    return { kind: "found", signedTransactionInfo: signed };
  }
  return { kind: "not_found" };
}
