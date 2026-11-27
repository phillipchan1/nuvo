/**
 * APNs — the native iPhone app's background reminders (D-259).
 *
 * The iOS shell has no service worker, so Web Push can't reach it. Apple's push
 * service can. A device registers through the `nuvo-push` plugin and is stored
 * in `push_subscriptions` like any other, with an endpoint of
 * `apns://<production|sandbox>/<hex token>` — so the dispatcher, the per-person
 * claim, the failure counter and the prune-on-gone path are all unchanged. This
 * file only knows how to deliver one message to one such endpoint.
 *
 * Auth is token-based (a .p8 key, ES256 JWT), cached per isolate and refreshed
 * well inside Apple's 60-minute window. `fetchImpl` is injectable for tests.
 */

import type { FetchLike, PushResult, PushSubscriptionRow } from "./webpush.ts";

export interface ApnsEnv {
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC?: string;
}

export const DEFAULT_APNS_TOPIC = "day.nuvo.app";

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

export type ApnsEnvironment = keyof typeof HOSTS;

export function apnsConfigured(env: ApnsEnv): boolean {
  return Boolean(env.APNS_KEY_P8?.trim() && env.APNS_KEY_ID?.trim() && env.APNS_TEAM_ID?.trim());
}

/** `apns://production/<hex>` → its parts; anything else (a Web Push URL) → null. */
export function parseApnsEndpoint(endpoint: string): { environment: ApnsEnvironment; token: string } | null {
  const m = /^apns:\/\/(production|sandbox)\/([0-9a-f]{32,200})$/i.exec(endpoint.trim());
  if (!m) return null;
  return { environment: m[1].toLowerCase() as ApnsEnvironment, token: m[2].toLowerCase() };
}

export function isApnsEndpoint(endpoint: string): boolean {
  return parseApnsEndpoint(endpoint) !== null;
}

// ── JWT ─────────────────────────────────────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  // Secrets pasted through a dashboard often lose their newlines or gain
  // literal "\n"s; keep only the base64 body either way.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/** Apple rejects a token older than an hour and throttles one minted too often
 *  (TooManyProviderTokenUpdates); 40 minutes sits safely between. */
const JWT_TTL_MS = 40 * 60_000;
let cached: { kid: string; iss: string; jwt: string; at: number } | null = null;

export async function apnsJwt(env: ApnsEnv, nowMs = Date.now()): Promise<string> {
  const kid = env.APNS_KEY_ID!.trim();
  const iss = env.APNS_TEAM_ID!.trim();
  if (cached && cached.kid === kid && cached.iss === iss && nowMs - cached.at < JWT_TTL_MS) {
    return cached.jwt;
  }
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid })));
  const claims = b64url(enc.encode(JSON.stringify({ iss, iat: Math.floor(nowMs / 1000) })));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env.APNS_KEY_P8!),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is already raw r‖s (IEEE P1363) — what JWS wants.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;
  cached = { kid, iss, jwt, at: nowMs };
  return jwt;
}

/** Test-only: forget the cached provider token. */
export function resetApnsJwtCache(): void {
  cached = null;
}

// ── Send ────────────────────────────────────────────────────────────────────

export interface ApnsMessage {
  title: string;
  body?: string;
  /** The reminder key — becomes the collapse id, so a retry replaces itself. */
  key: string;
  url?: string;
}

/** apns-collapse-id is capped at 64 bytes; reminder keys can be longer. */
async function collapseId(key: string): Promise<string> {
  if (new TextEncoder().encode(key).length <= 64) return key;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return b64url(digest).slice(0, 43);
}

/** Reasons that mean this token will never work again: drop the row. */
const GONE_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/**
 * Deliver one message to one APNs endpoint. Same result shape as Web Push, so
 * the dispatcher's claim / release / prune logic needs no second branch.
 *
 * `apns-expiration` is an hour: a reminder that couldn't reach a phone that was
 * off for longer is stale, and Apple should drop it rather than deliver it late.
 */
export async function sendApns(
  env: ApnsEnv,
  sub: PushSubscriptionRow,
  message: ApnsMessage,
  fetchImpl: FetchLike = fetch,
  nowMs = Date.now(),
): Promise<PushResult> {
  const target = parseApnsEndpoint(sub.endpoint);
  if (!target) return { ok: false, gone: false, error: "not an APNs endpoint" };
  if (!apnsConfigured(env)) return { ok: false, gone: false, error: "APNs keys not configured" };
  try {
    const jwt = await apnsJwt(env, nowMs);
    const res = await fetchImpl(`${HOSTS[target.environment]}/3/device/${target.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": env.APNS_TOPIC?.trim() || DEFAULT_APNS_TOPIC,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(nowMs / 1000) + 60 * 60),
        "apns-collapse-id": await collapseId(message.key),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        aps: {
          alert: message.body ? { title: message.title, body: message.body } : { title: message.title },
          sound: "default",
          "thread-id": "nuvo-reminders",
        },
        key: message.key,
        url: message.url ?? "/",
      }),
    });
    if (res.status === 200) return { ok: true, gone: false, status: 200 };
    if (res.status === 410) return { ok: false, gone: true, status: 410 };
    let reason = "";
    try {
      reason = ((await res.json()) as { reason?: string }).reason ?? "";
    } catch {
      /* no body */
    }
    if (res.status === 400 && GONE_REASONS.has(reason)) return { ok: false, gone: true, status: 400, error: reason };
    return { ok: false, gone: false, status: res.status, error: reason || "apns rejected" };
  } catch (e) {
    return { ok: false, gone: false, error: e instanceof Error ? e.message : "apns failed" };
  }
}

/** Sign a provider token without sending anything — push-dispatch's self-test. */
export async function apnsSelfTest(env: ApnsEnv): Promise<{ ok: boolean; error?: string }> {
  if (!apnsConfigured(env)) return { ok: false, error: "APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID not set" };
  try {
    resetApnsJwtCache();
    const jwt = await apnsJwt(env);
    return jwt.split(".").length === 3 ? { ok: true } : { ok: false, error: "signed, but malformed" };
  } catch {
    return { ok: false, error: "APNS_KEY_P8 could not sign (is it the .p8 file's full text?)" };
  }
}
