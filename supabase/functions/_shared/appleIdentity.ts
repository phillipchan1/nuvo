// Sign in with Apple — the server-side half of the identity.
//
// Two jobs, both of which have exactly one chance to happen:
//
//   • Persist the name and email Apple returns on the FIRST authorization for
//     an Apple ID + app pair. Every later sign-in returns them null, and the
//     only way back is the user revoking Nuvo in Settings → Apple ID. So a
//     later null must never overwrite a stored value — that is `mergeProfile`,
//     and it is why the merge lives here rather than inline in an upsert.
//
//   • Exchange the single-use (~5 min) authorization code for a refresh token,
//     because App Store guideline 5.1.1(v) requires account deletion to call
//     Apple's /auth/revoke and there is no other way to obtain a revocable
//     token. Nothing else can produce one after the code expires.
//
// The client_secret Apple wants is not a secret string: it is an ES256 JWT the
// caller signs with its own .p8 key. Same shape as the App Store Connect key,
// different key — see docs/apple-sign-in.md.
//
// Zero Deno-at-import-time so the pure half is testable under vitest; every
// Deno.env read happens inside a function.

export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

/** Apple's mail relay. The address works; it is just not the user's own. */
export function isPrivateRelayEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith("@privaterelay.appleid.com");
}

export type AppleProfile = {
  apple_user_id: string | null;
  email: string | null;
  given_name: string | null;
  family_name: string | null;
  is_private_relay: boolean;
};

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Fold this authorization's fields onto whatever is already stored.
 *
 * A stored value ALWAYS wins over an incoming null. This is the whole point:
 * sign-in #2 carries `email: null`, and a naive upsert would erase the only
 * copy of an address that can never be re-requested.
 */
export function mergeAppleProfile(
  stored: Partial<AppleProfile> | null | undefined,
  incoming: {
    appleUserId?: unknown;
    email?: unknown;
    givenName?: unknown;
    familyName?: unknown;
  },
): AppleProfile {
  const email = clean(incoming.email) ?? clean(stored?.email);
  return {
    apple_user_id: clean(incoming.appleUserId) ?? clean(stored?.apple_user_id),
    email,
    given_name: clean(incoming.givenName) ?? clean(stored?.given_name),
    family_name: clean(incoming.familyName) ?? clean(stored?.family_name),
    is_private_relay: isPrivateRelayEmail(email),
  };
}

/** "Ada" + "Lovelace" → "Ada Lovelace"; nothing → null. */
export function appleDisplayName(profile: Pick<AppleProfile, "given_name" | "family_name">): string | null {
  const name = [profile.given_name, profile.family_name].filter(Boolean).join(" ").trim();
  return name || null;
}

export type AppleAuthConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  clientId: string;
};

/**
 * The four values the token exchange and the revoke both need.
 *
 * `clientId` must be the SAME client the code was issued to, or Apple rejects
 * both calls. Native Sign in with Apple issues against the **bundle id**, so
 * that is the default (APPLE_BUNDLE_ID is already set for StoreKit); the web
 * redirect flow issues against the Services ID, which is what
 * APPLE_SIWA_CLIENT_ID overrides it with.
 *
 * Returns null when unconfigured — every caller treats that as "cannot revoke",
 * never as an error worth failing a sign-in or blocking a deletion.
 */
export function readAppleAuthConfig(
  env: Record<string, string | undefined>,
): AppleAuthConfig | null {
  const teamId = clean(env.APPLE_SIWA_TEAM_ID);
  const keyId = clean(env.APPLE_SIWA_KEY_ID);
  const privateKey = clean(env.APPLE_SIWA_PRIVATE_KEY);
  const clientId = clean(env.APPLE_SIWA_CLIENT_ID) ?? clean(env.APPLE_BUNDLE_ID);
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey, clientId };
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** PKCS#8 PEM (the .p8 Apple hands you, newlines optional) → raw DER. */
export function pkcs8FromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Apple's `client_secret`: an ES256 JWT, valid up to six months. Minted per
 * call (cheap) rather than cached, so a rotated key takes effect immediately.
 */
export async function appleClientSecret(
  config: AppleAuthConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(config.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlJson({ alg: "ES256", kid: config.keyId, typ: "JWT" });
  const claims = b64urlJson({
    iss: config.teamId,
    iat: nowSeconds,
    // Ten minutes. This JWT is used immediately and never stored.
    exp: nowSeconds + 600,
    aud: "https://appleid.apple.com",
    sub: config.clientId,
  });
  const input = `${header}.${claims}`;
  // WebCrypto ECDSA already returns raw r||s, which is exactly JWS ES256.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(input),
    ),
  );
  return `${input}.${b64url(signature)}`;
}

/**
 * Trade the one-shot authorization code for a refresh token.
 *
 * Returns null on any refusal: an expired or already-used code is the normal
 * case on a retry, and must never fail the sign-in that already succeeded.
 */
export async function exchangeAppleAuthorizationCode(
  config: AppleAuthConfig,
  code: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: await appleClientSecret(config),
  });
  const res = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const token = json && typeof json === "object" ? (json as Record<string, unknown>).refresh_token : null;
  return typeof token === "string" && token ? token : null;
}

/**
 * Sever Apple's grant. Called from account deletion — required by guideline
 * 5.1.1(v) for a Sign-in-with-Apple account, and a rejection reason on its own.
 *
 * Apple answers 200 with an empty body on success, and also on a token it has
 * already forgotten. Best-effort by design: a wipe must not be blockable by
 * Apple being unreachable.
 */
export async function revokeAppleToken(
  config: AppleAuthConfig,
  token: string,
  tokenTypeHint: "refresh_token" | "access_token" = "refresh_token",
): Promise<boolean> {
  const body = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
    client_id: config.clientId,
    client_secret: await appleClientSecret(config),
  });
  const res = await fetch(APPLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return res.ok;
}
