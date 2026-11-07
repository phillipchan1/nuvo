/**
 * The SPA half of the Worker's sign-in door (worker/src/signinDoor.ts) —
 * Google and Apple on Better Auth, used only when `VITE_API_BASE_URL` is set.
 *
 * Leaving: a top-level navigation to `${authBase}/signin/<provider>?return=<this origin>`,
 * so every OAuth cookie lives first-party on the API origin (WKWebView drops
 * third-party ones, which is why `authClient.signIn.social()` can't work in the
 * Mac or iOS shell). Coming back: the door lands on this origin with
 * `#nuvo_ott=<single-use token>` (or `#nuvo_auth_error=<code>`, or
 * `#nuvo_linked=<provider>`), which `consumeAuthReturn` trades for the signed
 * bearer and then wipes from the address bar.
 */
import { authBaseUrl } from "./backend";
import { authReturnUrl } from "./authRedirect";

export type DoorProvider = "google" | "apple";

const OTT = "nuvo_ott";
const ERROR = "nuvo_auth_error";
const LINKED = "nuvo_linked";

/** Where the door lives. `link` is a one-time token for the signed-in session. */
export function signInDoorUrl(provider: DoorProvider, link?: string): string {
  const base = authBaseUrl().replace(/\/+$/, "");
  const params = new URLSearchParams({ return: authReturnUrl() });
  if (link) params.set("link", link);
  return `${base}/signin/${provider}?${params.toString()}`;
}

/** Walk out through the door. Resolves only if the navigation didn't happen. */
export function goThroughDoor(provider: DoorProvider, link?: string): { error: null } {
  window.location.assign(signInDoorUrl(provider, link));
  return { error: null };
}

const MESSAGES: Record<string, string> = {
  provider_not_configured: "That sign-in option isn't available right now.",
  "email_doesn't_match": "That account's email doesn't match this one.",
  account_already_linked_to_different_user: "That account is already linked to a different Nuvo account.",
  session_missing: "Sign-in didn't finish. Try again.",
  state_mismatch: "Sign-in timed out. Try again.",
  access_denied: "Sign-in was cancelled.",
};

export function describeAuthReturnError(code: string): string {
  return MESSAGES[code] ?? "Sign-in didn't finish. Try again, or use your email.";
}

type ReturnState =
  | { kind: "none" }
  | { kind: "ott"; token: string }
  | { kind: "error"; code: string }
  | { kind: "linked"; provider: string };

/** Read and immediately strip the door's fragment (the token is single-use;
 *  it must not survive in history, a share sheet or a bookmark). */
export function takeAuthReturn(loc: Location = window.location, hist: History = window.history): ReturnState {
  const hash = loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash;
  if (!hash) return { kind: "none" };
  const params = new URLSearchParams(hash);
  const token = params.get(OTT);
  const code = params.get(ERROR);
  const linked = params.get(LINKED);
  if (!token && !code && !linked) return { kind: "none" };
  try {
    hist.replaceState(hist.state, "", `${loc.pathname}${loc.search}`);
  } catch {
    /* non-special schemes can refuse replaceState; the token is spent anyway */
  }
  if (token) return { kind: "ott", token };
  if (code) return { kind: "error", code };
  return { kind: "linked", provider: linked ?? "" };
}

let pendingError: string | null = null;

/** What the door said, if it came back with an error (the login screen shows
 *  it). A read, not a take: React may run an initializer twice. */
export function authReturnError(): string | null {
  return pendingError;
}

export function clearAuthReturnError(): void {
  pendingError = null;
}

/**
 * Called once at boot, before the first get-session: redeem a returned token
 * for the signed bearer (`set-auth-token`, captured by the auth client's
 * onSuccess → localStorage). Never throws.
 */
export async function consumeAuthReturn(
  verify: (token: string) => Promise<{ error?: { message?: string } | null } | unknown>,
): Promise<ReturnState["kind"]> {
  const state = takeAuthReturn();
  if (state.kind === "error") pendingError = describeAuthReturnError(state.code);
  if (state.kind !== "ott") return state.kind;
  try {
    const res = (await verify(state.token)) as { error?: { message?: string } | null } | undefined;
    if (res && res.error) pendingError = describeAuthReturnError("session_missing");
  } catch {
    pendingError = describeAuthReturnError("session_missing");
  }
  return "ott";
}
