import { supabase } from "./supabase";
import { authReturnUrl } from "./authRedirect";

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

/** Sign in (or sign up) with Google. Prefer linking onto an existing user first. */
export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: googleAuthOptions(),
  });
}

/** Attach Google to the currently signed-in user (keeps the same auth UUID). */
export async function linkGoogleIdentity() {
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
