import { hasScope, SCOPE_ACCOUNT, SCOPE_INBOX, type ScopedConnection } from "../../supabase/functions/_shared/connectionScopes.ts";
import type { Sql } from "./db.ts";

export { hasScope, SCOPE_ACCOUNT, SCOPE_INBOX };

export interface Connection extends ScopedConnection {
  id: string;
  user_id: string;
  app: string;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenFrom(req: Request): string {
  const dedicated = req.headers.get("x-nuvo-token")?.trim() ?? "";
  if (dedicated) return dedicated;
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export async function resolveConnection(sql: Sql, token: string): Promise<Connection | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const rows = (await sql`
    SELECT id, user_id, app, scopes
    FROM connections
    WHERE token_hash = ${tokenHash}
      AND revoked_at IS NULL
    LIMIT 1
  `) as Connection[];
  return rows[0] ?? null;
}

export async function touchConnection(sql: Sql, id: string): Promise<void> {
  await sql`
    UPDATE connections
    SET last_used_at = now()
    WHERE id = ${id}
  `;
}
