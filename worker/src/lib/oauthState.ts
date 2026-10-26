/** HMAC-signed OAuth state. Key is BETTER_AUTH_SECRET (never a billing secret). */

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlFromText(text: string): string {
  return b64url(new TextEncoder().encode(text));
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
  return b64url(new Uint8Array(sig));
}

export async function signState(secret: string, payload: Record<string, string>): Promise<string> {
  const body = b64urlFromText(JSON.stringify(payload));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyState(secret: string, state: string): Promise<Record<string, string>> {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(secret, body)) !== sig) throw new Error("bad oauth state");
  const padded = body.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return JSON.parse(atob(padded + pad)) as Record<string, string>;
}
