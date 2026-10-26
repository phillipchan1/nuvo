/** HMAC-signed OAuth state. Same shape as the Supabase helper, keyed by BETTER_AUTH_SECRET. */
export async function signState(secret: string, payload: Record<string, string>): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyState(secret: string, state: string): Promise<Record<string, string>> {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(secret, body)) !== sig) throw new Error("bad oauth state");
  return JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/"))) as Record<string, string>;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlBytes(new Uint8Array(sig));
}

function b64url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
