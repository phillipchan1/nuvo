import { supabase } from "./supabase";

/** Where Supabase sends the browser back after Google — this origin, always.
 *
 *  It MUST be in the project's redirect allow-list (Supabase → Authentication →
 *  URL Configuration). An unlisted value is not an error: Supabase silently
 *  falls back to the project's **Site URL**. In the Tauri shell that fallback is
 *  catastrophically quiet — the desktop webview lands on the hosted web app and
 *  signs in *there*, so the session is stored under `https://app.nuvo.day` while
 *  the bundled app (and the ⌥Space spotlight window, which loads the same
 *  `tauri://localhost` origin as main) stays signed out forever. The panel came
 *  up blank and nothing anywhere said why. Keep `tauri://localhost` allow-listed.
 *
 *  Non-special schemes can serialize `location.origin` as the string "null", so
 *  rebuild it from protocol + host rather than trusting `origin` in the shell. */
function returnUrl() {
  const { origin, protocol, host } = window.location;
  return origin && origin !== "null" ? origin : `${protocol}//${host}`;
}

/** Shared Google Auth options — login and identity linking both return here. */
function googleAuthOptions() {
  return {
    redirectTo: returnUrl(),
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
