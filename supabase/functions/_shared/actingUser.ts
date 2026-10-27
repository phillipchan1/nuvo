/**
 * Service-role acting-user path for billing (and any other edge function
 * that still lives on Supabase after the Better Auth flip).
 *
 * The Worker verifies a Better Auth session, then calls the existing
 * function with the service-role key and the verified user id in
 * `X-Nuvo-Acting-User`. Clients never have that key; a leaked user id
 * without it is still 401. The header is ignored on any other bearer.
 *
 * After cutover, Better Auth `user.id` equals GoTrue `auth.users.id`
 * (same UUID copied). New BA users may not exist in GoTrue, so this
 * path must not call `auth.admin.getUserById`.
 */
export const ACTING_USER_HEADER = "x-nuvo-acting-user";
export const ACTING_EMAIL_HEADER = "x-nuvo-acting-email";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActingUser = {
  id: string;
  email?: string;
  user_metadata: Record<string, unknown>;
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Constant-time compare. Length mismatch is false; no throw. */
export function sameSecret(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i++) {
    out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return out === 0;
}

export function bearerToken(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Returns the acting user only when the bearer is the service-role key
 * AND the acting-user header is a UUID. Never reads a client-supplied
 * id from the body or query.
 */
export function actingUserFromRequest(req: Request, serviceRole: string): ActingUser | null {
  const key = (serviceRole ?? "").trim();
  if (!key) return null;
  if (!sameSecret(bearerToken(req), key)) return null;
  const id = (req.headers.get(ACTING_USER_HEADER) ?? "").trim();
  if (!isUuid(id)) return null;
  const email = (req.headers.get(ACTING_EMAIL_HEADER) ?? "").trim();
  return {
    id,
    email: email || undefined,
    user_metadata: {},
  };
}
