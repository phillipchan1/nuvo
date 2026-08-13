/**
 * Web Push — VAPID auth and aes128gcm payload encryption, on Deno's WebCrypto.
 *
 * Hand-rolled rather than pulled from npm, and that deserves a reason: the
 * ubiquitous `web-push` package is a Node library that reaches for `crypto`,
 * `https` and Buffer, and the versions that do work under Deno pull a
 * dependency tree larger than this file for two operations that are, in the
 * end, one JWT and one ECDH. Edge functions cold-start on every cron tick;
 * a megabyte of shim for that is the wrong trade.
 *
 * What actually happens, per RFC 8291 (encryption) and RFC 8292 (auth):
 *
 *   1. Generate an ephemeral P-256 keypair, ECDH it against the subscriber's
 *      public key (`p256dh`) to get a shared secret.
 *   2. HKDF that secret with the subscriber's `auth` salt into a content
 *      encryption key and a nonce, using the fixed info strings from the RFC.
 *   3. AES-128-GCM the payload, and prepend the aes128gcm header (salt,
 *      record size, and our ephemeral public key) so the browser can do the
 *      same derivation in reverse.
 *   4. Separately, sign a short JWT with the VAPID private key so the push
 *      service knows who is sending.
 *
 * The two are independent: VAPID says *who*, the encryption says *what*, and
 * the push service can read neither the payload nor anything about the user.
 */

/** Set these with `supabase secrets set`. Generate with `npx web-push generate-vapid-keys`. */
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
/** A contact the push service can reach if something is wrong. RFC 8292 wants
 *  `mailto:` or `https:`. */
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@nuvo.app";

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
  /** The endpoint is permanently gone (404/410) — delete it, don't retry. */
  gone: boolean;
  error?: string;
}

export function webPushConfigured(): boolean {
  return VAPID_PUBLIC.length > 0 && VAPID_PRIVATE.length > 0;
}

// ── base64url ───────────────────────────────────────────────────────────────

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

/**
 * TypeScript 5.7 made `Uint8Array` generic over its buffer
 * (`Uint8Array<ArrayBufferLike>`), and WebCrypto/fetch signatures want the
 * narrower `ArrayBuffer` form. Every array here is freshly allocated and never
 * shared, so the narrowing is true — it just isn't provable from a helper's
 * return type. One alias, asserted at the point of allocation, keeps the casts
 * out of the crypto itself where they'd be easy to misread.
 */
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

// ── VAPID (RFC 8292) ────────────────────────────────────────────────────────

/**
 * A signed assertion that this sender is who the subscription expects.
 *
 * ES256 over `{aud, exp, sub}`. `aud` is the push service's ORIGIN — not the
 * full endpoint — and a mismatch is rejected with a 401 that reads like an
 * unrelated auth problem, which is the classic way to lose an afternoon here.
 */
async function vapidHeaders(endpoint: string): Promise<Record<string, string>> {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        // 12h. The spec caps it at 24; short enough that a leaked token dies,
        // long enough that clock skew never matters.
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: VAPID_SUBJECT,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: VAPID_PRIVATE,
      // The public half, as the JWK's x/y coordinates. The stored public key is
      // the uncompressed point (0x04 ‖ X ‖ Y).
      x: bytesToB64url(b64urlToBytes(VAPID_PUBLIC).slice(1, 33)),
      y: bytesToB64url(b64urlToBytes(VAPID_PUBLIC).slice(33, 65)),
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
    Authorization: `vapid t=${signingInput}.${bytesToB64url(signature)}, k=${VAPID_PUBLIC}`,
  };
}

// ── Payload encryption (RFC 8291, aes128gcm) ────────────────────────────────

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits) as Bytes;
}

async function encryptPayload(
  payload: string,
  p256dhB64: string,
  authB64: string,
): Promise<Bytes> {
  const clientPublic = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);

  // A fresh keypair per message: reusing one would let a push service correlate
  // messages to the same recipient over time.
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as Bytes;

  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, ephemeral.privateKey, 256),
  ) as Bytes;

  const enc = new TextEncoder();
  // The key-derivation info string binds the two public keys into the secret,
  // so a message can't be replayed against a different subscriber.
  const prkInfo = concat(
    enc.encode("WebPush: info\0") as Bytes,
    clientPublic,
    ephemeralPublic,
  );
  const prk = await hkdf(authSecret, shared, prkInfo, 32);

  const salt = crypto.getRandomValues(alloc(16));
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0") as Bytes, 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0") as Bytes, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // A single record, so the padding delimiter is 0x02 ("last record").
  const plaintext = concat(enc.encode(payload) as Bytes, Uint8Array.from([2]) as Bytes);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
  ) as Bytes;

  // aes128gcm header: salt(16) ‖ record size(4, big-endian) ‖ keyid length(1) ‖ keyid
  const recordSize = alloc(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concat(salt, recordSize, Uint8Array.from([ephemeralPublic.length]) as Bytes, ephemeralPublic, ciphertext);
}

// ── Send ────────────────────────────────────────────────────────────────────

/**
 * Deliver one payload to one subscription.
 *
 * Never throws: a dispatcher looping over a hundred devices must not stop
 * because one phone was factory-reset. `gone` is the caller's cue to delete.
 */
export async function sendWebPush(sub: PushSubscriptionRow, payload: string): Promise<PushResult> {
  if (!webPushConfigured()) {
    return { ok: false, gone: false, error: "VAPID keys not configured" };
  }
  try {
    const body = await encryptPayload(payload, sub.p256dh, sub.auth);
    const headers = await vapidHeaders(sub.endpoint);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        // How long the push service should hold it if the device is offline.
        // A reminder is a *now* signal — an hour late it is noise, so it expires
        // rather than arriving during dinner.
        TTL: "600",
        Urgency: "high",
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, status: res.status };
    if (!res.ok) {
      return { ok: false, gone: false, status: res.status, error: await res.text().catch(() => "") };
    }
    return { ok: true, gone: false, status: res.status };
  } catch (e) {
    return { ok: false, gone: false, error: e instanceof Error ? e.message : String(e) };
  }
}
