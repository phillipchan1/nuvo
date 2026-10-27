/**
 * Web Push — VAPID auth and aes128gcm payload encryption (RFC 8291 / 8292).
 *
 * Port of `supabase/functions/_shared/webpush.ts`. Secrets come from the
 * Worker env (same VAPID pair as today — a new pair breaks every sub).
 * `fetchImpl` is injectable so tests can mock the push endpoint.
 */

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count?: number;
}

export interface PushResult {
  ok: boolean;
  status?: number;
  gone: boolean;
  error?: string;
}

export interface VapidEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export function webPushConfigured(env: VapidEnv): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim());
}

export async function webPushSelfTest(
  env: VapidEnv,
  clientPublicKey?: string,
): Promise<{ ok: boolean; error?: string; matchesClient?: boolean }> {
  if (!webPushConfigured(env)) {
    return { ok: false, error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set" };
  }
  try {
    const headers = await vapidHeaders(env, "https://fcm.googleapis.com/fcm/send/self-test");
    if (!headers.Authorization?.startsWith("vapid t=")) {
      return { ok: false, error: "signed, but the header came out malformed" };
    }
    const pub = env.VAPID_PUBLIC_KEY!.trim();
    const matchesClient = clientPublicKey ? clientPublicKey.trim() === pub : undefined;
    return { ok: true, matchesClient };
  } catch {
    return { ok: false, error: "VAPID keys could not sign" };
  }
}

type Bytes = Uint8Array & { buffer: ArrayBuffer };

function alloc(n: number): Bytes {
  return new Uint8Array(new ArrayBuffer(n)) as Bytes;
}

function concat(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = alloc(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function b64urlToBytes(s: string): Bytes {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = alloc(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function vapidHeaders(env: VapidEnv, endpoint: string): Promise<Record<string, string>> {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: env.VAPID_SUBJECT?.trim() || "mailto:support@nuvo.app",
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const pub = env.VAPID_PUBLIC_KEY!.trim();
  const priv = env.VAPID_PRIVATE_KEY!.trim();

  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: priv,
      x: bytesToB64url(b64urlToBytes(pub).slice(1, 33)),
      y: bytesToB64url(b64urlToBytes(pub).slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)),
  ) as Bytes;

  return {
    Authorization: `vapid t=${signingInput}.${bytesToB64url(signature)}, k=${pub}`,
  };
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits) as Bytes;
}

async function encryptPayload(payload: string, p256dhB64: string, authB64: string): Promise<Bytes> {
  const clientPublic = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);

  // Workers types widen generateKey to CryptoKey | CryptoKeyPair and spell
  // the ECDH peer as `$public`. The runtime is standard WebCrypto.
  const ephemeral = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const ephemeralPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer,
  ) as Bytes;

  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      ephemeral.privateKey,
      256,
    ),
  ) as Bytes;

  const enc = new TextEncoder();
  const prkInfo = concat(enc.encode("WebPush: info\0") as Bytes, clientPublic, ephemeralPublic);
  const prk = await hkdf(authSecret, shared, prkInfo, 32);

  const salt = crypto.getRandomValues(alloc(16));
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0") as Bytes, 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0") as Bytes, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(enc.encode(payload) as Bytes, Uint8Array.from([2]) as Bytes);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
  ) as Bytes;

  const recordSize = alloc(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concat(salt, recordSize, Uint8Array.from([ephemeralPublic.length]) as Bytes, ephemeralPublic, ciphertext);
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function sendWebPush(
  env: VapidEnv,
  sub: PushSubscriptionRow,
  payload: string,
  fetchImpl: FetchLike = fetch,
): Promise<PushResult> {
  if (!webPushConfigured(env)) {
    return { ok: false, gone: false, error: "VAPID keys not configured" };
  }
  try {
    const body = await encryptPayload(payload, sub.p256dh, sub.auth);
    const headers = await vapidHeaders(env, sub.endpoint);
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "600",
        Urgency: "high",
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, status: res.status };
    if (!res.ok) {
      return { ok: false, gone: false, status: res.status, error: "push rejected" };
    }
    return { ok: true, gone: false, status: res.status };
  } catch (e) {
    return { ok: false, gone: false, error: e instanceof Error ? e.message : "push failed" };
  }
}
