// The two WebCrypto primitives the app keeps needing: a URL-safe random token
// and a SHA-256 hex digest.
//
// They live here because the digest has to agree with a server that recomputes
// it — `sha256Hex` in supabase/functions/_shared/connections.ts for connection
// tokens, and GoTrue's own hashing for the Sign in with Apple nonce. Two copies
// of "hash a string to hex" is two chances for one of them to drift into
// base64, and the failure is silent on both sides (a token that never matches,
// a nonce Apple accepts and Supabase rejects opaquely).
//
// `crypto.subtle` needs a secure context. Every shell Nuvo runs in has one —
// https on the web, `tauri://localhost` in both native shells — and the app
// already depends on this (connection tokens, `crypto.randomUUID` throughout),
// so there is no non-secure fallback here on purpose: a silent weaker path is
// worse than a loud failure.

/** URL-safe, 43 chars of entropy from the platform CSPRNG. */
export function randomUrlSafeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Lowercase hex SHA-256. Must match `sha256Hex` in
 *  supabase/functions/_shared/connections.ts exactly. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
