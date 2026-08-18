// Scope names on `connections.scopes`. Pure so the battery can pin the
// implication (`account` includes inbox) without loading the Deno admin client.

export const SCOPE_INBOX = "inbox:write";
/** Full agent vocabulary — domains, projects, tasks, calendar, the snapshot. */
export const SCOPE_ACCOUNT = "account";

export interface ScopedConnection {
  scopes: string[];
}

/** `account` includes inbox: a teammate that can run Nuvo can also capture. */
export function hasScope(conn: ScopedConnection, scope: string): boolean {
  const scopes = conn.scopes ?? [];
  if (scopes.includes(scope)) return true;
  return scope === SCOPE_INBOX && scopes.includes(SCOPE_ACCOUNT);
}
