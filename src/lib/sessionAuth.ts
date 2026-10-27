/**
 * Session id + bearer for call sites that used to read supabase.auth.
 * After the Worker flip, Better Auth holds the session — GoTrue does not.
 */
import { workersEnabled } from "./backend";

let cachedUserId: string | null = null;
let cachedToken: string | null = null;

export function rememberClientSession(
  session: { user?: { id?: string | null } | null; access_token?: string | null } | null,
): void {
  cachedUserId = session?.user?.id ?? null;
  cachedToken = session?.access_token ?? null;
}

export function resetClientSessionForTests(): void {
  cachedUserId = null;
  cachedToken = null;
}

export async function currentUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  if (workersEnabled) {
    const { signedBearerToken } = await import("./authClient");
    if (!signedBearerToken() && !cachedToken) return null;
    return cachedUserId;
  }
  const { supabase } = await import("./supabase");
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id ?? null;
  if (id) cachedUserId = id;
  return id;
}

export async function currentAccessToken(): Promise<string | null> {
  if (workersEnabled) {
    const { signedBearerToken } = await import("./authClient");
    return signedBearerToken() ?? cachedToken;
  }
  if (cachedToken) return cachedToken;
  const { supabase } = await import("./supabase");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  if (token) cachedToken = token;
  return token;
}

export async function workerAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const token = await currentAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}
