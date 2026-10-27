/**
 * Look up a Better Auth user email on the Worker. Neon-only users are
 * not in GoTrue, so referralNotify cannot use getUserById after the flip.
 *
 * Auth is the existing service-role key (already on the Worker and the
 * edge functions). Smaller than minting a new secret or creating a
 * shadow auth.users row. Stripe takes the payer email from the Stripe
 * object instead — see stripePayerEmail.
 */
import { UUID_RE } from "./actingUser.ts";

export function workerUserEmailUrl(apiBase: string, userId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/api/internal/user-email?id=${encodeURIComponent(userId)}`;
}

export async function workerUserEmail(
  userId: string,
  env: { apiBase?: string; serviceRole?: string },
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  if (!UUID_RE.test(userId)) return undefined;
  const base = (env.apiBase ?? "").trim();
  const secret = (env.serviceRole ?? "").trim();
  if (!base || !secret) return undefined;
  try {
    const res = await fetchFn(workerUserEmailUrl(base, userId), {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    return email || undefined;
  } catch {
    return undefined;
  }
}
