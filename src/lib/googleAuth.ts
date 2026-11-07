import { supabase } from "./supabase";
import { authReturnUrl } from "./authRedirect";
import { workersEnabled } from "./backend";

/** Shared Google Auth options — login and identity linking both return here.
 *
 *  `prompt=select_account` is what makes Google draw the account chooser. Without
 *  it Google silently re-uses whichever Google account last signed in on this
 *  webview and returns immediately, so on a signed-out iPhone "Continue with
 *  Google" landed straight back in the previous user's account and there was no
 *  moment at which a second Google could be chosen — no chooser, nothing to tap.
 *
 *  On iOS this happens **inside the app**: it never opens Safari, and that is not
 *  the symptom of a second auth path, it is the only path there is. The shell has
 *  no ASWebAuthenticationSession, no SFSafariViewController and no native Google
 *  Sign-In — Apple is the one provider with a native leg (`nuvo-siwa` presents
 *  `ASAuthorizationController`, a system sheet rather than a browser session, and
 *  it never touches Google) — and `signInWithOAuth` without
 *  `skipBrowserRedirect` just does `window.location.assign`. So the app's own
 *  WKWebView walks to Google and back to `tauri://localhost` — and that webview's
 *  cookie jar, which nothing in Nuvo can clear, outlives a Nuvo sign-out. Which
 *  is why one parameter on this one request is the whole fix.
 *
 *  Sent on every attempt, not only when it would be ambiguous: the app cannot
 *  read Google's cookies, so "is more than one Google signed in here" is not a
 *  state it can ask about. One extra tap at the door is the cost of the door
 *  existing at all. GoTrue forwards authorize params it doesn't consume straight
 *  through to the provider, so this is the provider's own parameter — not a
 *  second auth path. */
function googleAuthOptions() {
  return {
    redirectTo: authReturnUrl(),
    queryParams: { prompt: "select_account" },
  };
}

/** Sign in (or sign up) with Google. Prefer linking onto an existing user first.
 *
 *  Flag on (Better Auth): the Worker's sign-in door, a top-level navigation —
 *  `prompt=select_account` (above, D-126) is set by the Worker's Google
 *  provider, so it holds on every shell. The return leg comes back to this
 *  origin (`tauri://localhost` included) as a one-time token; see authReturn.ts. */
export async function signInWithGoogle(): Promise<{ error: { message: string } | null }> {
  if (workersEnabled) {
    const { goThroughDoor } = await import("./authReturn");
    return goThroughDoor("google");
  }
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: googleAuthOptions(),
  });
}

/** Attach Google to the currently signed-in user (keeps the same auth UUID). */
export async function linkGoogleIdentity(): Promise<{ error: { message: string } | null }> {
  if (workersEnabled) return linkThroughDoor("google");
  return supabase.auth.linkIdentity({
    provider: "google",
    options: googleAuthOptions(),
  });
}

export function hasGoogleIdentity(
  identities: { provider: string }[] | undefined | null,
): boolean {
  return Boolean(identities?.some((i) => i.provider === "google"));
}

/** Flag on: mint a one-time token for this session (bearer, never a URL) and
 *  walk the door with it, so linking needs no cookie on the API origin. */
export async function linkThroughDoor(provider: "google" | "apple"): Promise<{ error: { message: string } | null }> {
  const { createNuvoAuthClient } = await import("./authClient");
  const res = await createNuvoAuthClient().oneTimeToken.generate();
  const token = res.data?.token;
  if (!token) return { error: { message: res.error?.message || "Couldn't start linking. Try again." } };
  const { goThroughDoor } = await import("./authReturn");
  return goThroughDoor(provider, token);
}
