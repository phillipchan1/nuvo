import { supabase } from "./supabase";
import { authReturnUrl } from "./authRedirect";

/** Shared Google Auth options — login and identity linking both return here. */
function googleAuthOptions() {
  return {
    redirectTo: authReturnUrl(),
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
