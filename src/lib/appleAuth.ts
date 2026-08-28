// Sign in with Apple — the SPA half. Mirrors ./googleAuth.ts.
//
// **Why it is not optional.** Nuvo offers Google Sign-In, which forfeits App
// Store guideline 4.8's "own account system only" exemption. An iOS binary
// without this is a rejection.
//
// **Two paths, one entry point.**
//   • Native iOS (`isTauriIOS`) — the nuvo-siwa plugin presents
//     ASAuthorizationController and hands back Apple's identity token, which
//     goes to `signInWithIdToken`. Nothing leaves the app, so there is no
//     redirect to strand and no Services ID involved.
//   • Web / desktop — `signInWithOAuth`, a redirect, subject to the Site-URL
//     trap documented in ./authRedirect.ts.
//
// **THE NONCE — the one thing that fails.** We mint a raw nonce, send Apple
// its **SHA-256 hex digest** (Apple copies that verbatim into the identity
// token's `nonce` claim), and send the **raw** value to Supabase, which hashes
// it and compares. Send the same string to both and Apple is perfectly happy
// while Supabase rejects the token with nothing but an opaque error. The
// hashing happens here and nowhere else — Swift never hashes (see
// NuvoSiwaPlugin.swift) precisely so the pair cannot drift.
//
// **What Apple gives back once, ever.** `email` / `givenName` / `familyName`
// are populated on the **first authorization for this Apple ID + app pair and
// never again** — the only way back is the user revoking Nuvo in Settings →
// Apple ID. So the first callback ships them to the `apple-identity` function
// immediately. The same call carries the single-use authorization code, which
// the server exchanges for the refresh token that account deletion must revoke
// (guideline 5.1.1(v) + Apple's /auth/revoke). Best-effort: a failure never
// blocks the sign-in, and the next sign-in mints a fresh code to retry with.
//
// The email may be a `@privaterelay.appleid.com` alias. Anything that mails the
// user has to tolerate that.
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { authReturnUrl } from "./authRedirect";
import { isTauriIOS } from "./platform";
import { randomUrlSafeToken, sha256Hex } from "./webcrypto";

/** Backing out of Apple's sheet. Must match `cancelledMessage` in
 *  src-tauri/plugins/nuvo-siwa/ios/Sources/NuvoSiwaPlugin.swift. */
export const APPLE_SIGN_IN_CANCELLED = "Sign in with Apple was cancelled";

export function isAppleSignInCancelled(message: string | null | undefined): boolean {
  return (message ?? "").trim() === APPLE_SIGN_IN_CANCELLED;
}

/** What the native plugin returns. `supported` is false off iOS. */
type AppleCredential = {
  supported: boolean;
  identityToken?: string | null;
  authorizationCode?: string | null;
  user?: string | null;
  email?: string | null;
  givenName?: string | null;
  familyName?: string | null;
};

/**
 * Whether to offer the button at all — "only render it where it works".
 *
 * Native iOS: always. The entitlement ships in the binary and the plugin is
 * registered unconditionally, so if this shell is the App Store build the
 * sheet exists.
 *
 * Web / desktop: only when `VITE_APPLE_AUTH=1`. That path needs a Services ID
 * and key configured in Supabase → Authentication → Providers → Apple, which
 * the client cannot detect; without the flag the button would render and then
 * fail with "provider is not enabled". Default off, so today's Vercel build
 * shows Google + email exactly as before. docs/apple-sign-in.md turns it on.
 */
export function appleSignInAvailable(): boolean {
  return isTauriIOS() || appleWebAuthConfigured();
}

/** The redirect half specifically: a Services ID + key in Supabase, which the
 *  client cannot see, so it is declared with `VITE_APPLE_AUTH=1`. */
export function appleWebAuthConfigured(): boolean {
  return import.meta.env.VITE_APPLE_AUTH === "1";
}

/** Whether to offer "Link Apple" in Settings.
 *
 *  Gated on the *web* flow even on iOS, because linking always is one:
 *  `linkIdentity` has no id-token form, so it goes through Supabase's
 *  /authorize?provider=apple and needs the Services ID. Showing the row
 *  without it would offer a button that only ever errors. */
export function appleLinkAvailable(): boolean {
  return appleWebAuthConfigured();
}

function appleAuthOptions() {
  return {
    redirectTo: authReturnUrl(),
    // Apple only returns name/email when they are asked for by scope.
    scopes: "name email",
  };
}

/** Present Apple's native sheet. Null when this shell has no plugin — an older
 *  TestFlight build, or any non-iOS shell — which the caller handles rather
 *  than treating as a failed sign-in. A cancel re-throws instead: backing out
 *  is an answer, not an absent capability. */
async function nativeCredential(hashedNonce: string): Promise<AppleCredential | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // `{ payload: … }` is the shape Tauri v2 plugin commands take — the Rust
    // command's argument is literally named `payload`. A flat object silently
    // fails to deserialize.
    const credential = await invoke<AppleCredential>("plugin:nuvo-siwa|sign_in", {
      payload: { nonce: hashedNonce },
    });
    return credential?.supported ? credential : null;
  } catch (e) {
    // A cancel IS a real answer — never fall through to a redirect the user
    // did not ask for. Everything else means "no native path here".
    const message = e instanceof Error ? e.message : String(e);
    if (isAppleSignInCancelled(message)) throw e;
    return null;
  }
}

/** Persist what Apple only ever says once, plus the code that makes deletion
 *  revocable. Never throws — sign-in has already succeeded by this point. */
async function rememberAppleIdentity(credential: AppleCredential): Promise<void> {
  try {
    await supabase.functions.invoke("apple-identity", {
      body: {
        appleUserId: credential.user ?? null,
        authorizationCode: credential.authorizationCode ?? null,
        email: credential.email ?? null,
        givenName: credential.givenName ?? null,
        familyName: credential.familyName ?? null,
      },
    });
  } catch {
    /* best effort — the next sign-in carries a fresh authorization code */
  }
}

/** Sign in (or sign up) with Apple. */
export async function signInWithApple(): Promise<{ error: AuthError | Error | null }> {
  if (isTauriIOS()) {
    let credential: AppleCredential | null = null;
    let rawNonce = "";
    try {
      rawNonce = randomUrlSafeToken();
      credential = await nativeCredential(await sha256Hex(rawNonce));
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
    if (credential?.identityToken) {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
        // RAW, not the digest. Supabase hashes this and compares it to the
        // token's `nonce` claim.
        nonce: rawNonce,
      });
      if (!error) await rememberAppleIdentity(credential);
      return { error };
    }
    // No plugin in this shell — an older TestFlight build. Only fall through to
    // the redirect if the web flow is actually configured: otherwise it
    // navigates the app itself to a Supabase provider-error page, inside a
    // shell with no back button, and the person is simply stuck.
    if (!appleWebAuthConfigured()) {
      return {
        error: new Error(
          "Sign in with Apple isn't available in this version of the app. Update from TestFlight, or continue with Google.",
        ),
      };
    }
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: appleAuthOptions(),
  });
  return { error };
}

/** Attach Apple to the currently signed-in user (keeps the same auth UUID).
 *
 *  Always the redirect flow: `linkIdentity` has no id-token form, and linking
 *  is what stops an existing account from ending up with a second, empty one
 *  the first time its owner taps Sign in with Apple. */
export async function linkAppleIdentity() {
  return supabase.auth.linkIdentity({
    provider: "apple",
    options: appleAuthOptions(),
  });
}

export function hasAppleIdentity(
  identities: { provider: string }[] | undefined | null,
): boolean {
  return Boolean(identities?.some((i) => i.provider === "apple"));
}
