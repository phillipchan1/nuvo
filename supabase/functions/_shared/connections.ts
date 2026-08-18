// Per-app bearer tokens (`connections` table). The Capture API and the MCP
// endpoint share this lookup so a token minted in Settings → Apps & devices
// authenticates the same way wherever it is presented.
//
// The raw token is never stored: we keep sha256(hex) and compare hashes.
import { admin } from "./admin.ts";
export { SCOPE_INBOX, SCOPE_ACCOUNT, hasScope } from "./connectionScopes.ts";

export interface Connection {
  id: string;
  user_id: string;
  app: string;
  scopes: string[];
}

/** sha256(token) as lowercase hex — what we store and compare against. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bearer from Authorization, or the dedicated header some MCP clients use
 *  when Authorization has to carry the gateway's anon key. */
export function tokenFrom(req: Request): string {
  const dedicated = req.headers.get("x-nuvo-token")?.trim() ?? "";
  if (dedicated) return dedicated;
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export async function resolveConnection(token: string): Promise<Connection | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const { data: conn } = await admin
    .from("connections")
    .select("id, user_id, app, scopes")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle<Connection>();
  return conn ?? null;
}

export const touchConnection = (id: string) =>
  admin.from("connections").update({ last_used_at: new Date().toISOString() }).eq("id", id);
