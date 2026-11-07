/**
 * Better Auth browser client. Lazy-imported only when VITE_API_BASE_URL is set.
 * Stores the signed `set-auth-token` (not the raw DB session token) and sends
 * it as Bearer — Better Auth is configured with requireSignature.
 */
import { createAuthClient } from "better-auth/client";
import { emailOTPClient, oneTimeTokenClient } from "better-auth/client/plugins";
import { authBaseUrl } from "./backend";
import { AUTH_SESSION_CHANGED } from "./entitlementRead";

export { AUTH_SESSION_CHANGED };

function emitAuthSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED));
}

const SIGNED_BEARER_KEY = "nuvo.ba.signed-bearer";

/**
 * localStorage, not sessionStorage (blocker 10, docs/cloudflare-cutover.md):
 * WKWebView (Mac + iOS) and an installed PWA start every launch with an
 * empty sessionStorage, so a relaunch signed the person out. GoTrue's
 * session already lives in localStorage today, so this is no new exposure.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** One-time move of a bearer written by a build that used sessionStorage. */
function adoptLegacyBearer(target: Storage): void {
  try {
    const legacy = sessionStorage.getItem(SIGNED_BEARER_KEY);
    if (legacy == null) return;
    if (target.getItem(SIGNED_BEARER_KEY) == null) target.setItem(SIGNED_BEARER_KEY, legacy);
    sessionStorage.removeItem(SIGNED_BEARER_KEY);
  } catch {
    /* private mode / SSR */
  }
}

export function signedBearerToken(): string | null {
  const s = store();
  if (!s) return null;
  try {
    adoptLegacyBearer(s);
    return s.getItem(SIGNED_BEARER_KEY);
  } catch {
    return null;
  }
}

function rememberSignedBearer(token: string) {
  const s = store();
  try {
    // Unchanged is not a change: useAuth re-reads the session on this event,
    // and get-session hands the same token back.
    if (s?.getItem(SIGNED_BEARER_KEY) === token) return;
    s?.setItem(SIGNED_BEARER_KEY, token);
  } catch {
    /* private mode / SSR */
  }
  emitAuthSessionChanged();
}

/** Drop the signed bearer on Better Auth sign-out so the next account
 *  on this device cannot reuse it, and so the entitlement probe re-runs. */
export function clearSignedBearer() {
  try {
    store()?.removeItem(SIGNED_BEARER_KEY);
    sessionStorage.removeItem(SIGNED_BEARER_KEY);
  } catch {
    /* private mode / SSR */
  }
  emitAuthSessionChanged();
}

// Shared storage means a sign-in or sign-out in one tab is every tab's:
// re-read the session there too instead of 401-ing on a dropped bearer.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SIGNED_BEARER_KEY || e.key === null) emitAuthSessionChanged();
  });
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
    plugins: [emailOTPClient(), oneTimeTokenClient()],
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
