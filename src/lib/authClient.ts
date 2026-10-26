/**
 * Better Auth browser client. Lazy-imported only when VITE_API_BASE_URL is set.
 * Stores the signed `set-auth-token` (not the raw DB session token) and sends
 * it as Bearer — Better Auth is configured with requireSignature.
 */
import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { authBaseUrl } from "./backend";
import { AUTH_SESSION_CHANGED } from "./entitlementRead";

export { AUTH_SESSION_CHANGED };

function emitAuthSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED));
}

const SIGNED_BEARER_KEY = "nuvo.ba.signed-bearer";

export function signedBearerToken(): string | null {
  try {
    return sessionStorage.getItem(SIGNED_BEARER_KEY);
  } catch {
    return null;
  }
}

function rememberSignedBearer(token: string) {
  try {
    sessionStorage.setItem(SIGNED_BEARER_KEY, token);
  } catch {
    /* private mode / SSR */
  }
  emitAuthSessionChanged();
}

/** Drop the signed bearer on Better Auth sign-out so the next account
 *  on this device cannot reuse it, and so the entitlement probe re-runs. */
export function clearSignedBearer() {
  try {
    sessionStorage.removeItem(SIGNED_BEARER_KEY);
  } catch {
    /* private mode / SSR */
  }
  emitAuthSessionChanged();
}

/** Persist a signed `token.hmac` so a new tab can reuse get-session's JSON. */
export function persistSignedBearer(token: string) {
  if (token.includes(".")) rememberSignedBearer(token);
}

export function createNuvoAuthClient() {
  const base = authBaseUrl();
  if (!base) throw new Error("VITE_API_BASE_URL is not set");
  return createAuthClient({
    baseURL: base.replace(/\/api$/, "") || base,
    basePath: "/api/auth",
    plugins: [emailOTPClient()],
    fetchOptions: {
      credentials: "include",
      auth: {
        type: "Bearer",
        token: () => signedBearerToken() ?? undefined,
      },
      onSuccess(ctx) {
        const header = ctx.response.headers.get("set-auth-token");
        if (header) rememberSignedBearer(header);
      },
    },
  });
}

export type NuvoAuthClient = ReturnType<typeof createNuvoAuthClient>;
