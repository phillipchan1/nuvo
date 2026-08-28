// Which way this person signs in — the vocabulary, and this device's memory of
// it.
//
// **Why a memory at all.** Supabase mints a user per *identity*, and folds two
// identities onto one account only when they share a **verified email**. Sign
// in with Google as ada@example.com and later with Apple as ada@example.com and
// you land in the same account, same UUID, same data. But choose Apple's
// "Hide My Email" and Apple asserts `abc123@privaterelay.appleid.com` instead —
// a different address, so nothing can match it, and Supabase correctly creates
// a second, empty account. Nuvo is multi-tenant: that account is not broken,
// it is just not yours. Nothing on either side can detect the pair afterwards,
// because the only thing they have in common is a person.
//
// So the answer is prevention, not repair: remember what this device used last
// and say so on the login screen, and make Settings show which methods are
// attached rather than only which are missing. The cure, if someone does land
// on a fresh account, is to delete it (Settings → Account) and link instead —
// never a data merge across two tenants.
//
// Device-local on purpose. It is a hint, never a credential and never a claim
// about who is signed in; it survives sign-out precisely so the *next* sign-in
// can be the same one.

export type AuthProviderId = "google" | "apple" | "email";

const LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  email: "an email code",
};

/** For prose — "last time you used …". */
export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return "another method";
  return LABELS[provider] ?? provider;
}

const ROW_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  email: "Email code",
};

/** For a row title, where "an email code" would read as a sentence fragment. */
export function providerRowLabel(provider: string): string {
  return ROW_LABELS[provider] ?? provider;
}

const KEY = "nuvo.last-auth-provider";

/** The provider of the most recent successful sign-in on this device. */
export function rememberAuthProvider(provider: string | null | undefined): void {
  if (!provider) return;
  try {
    localStorage.setItem(KEY, provider);
  } catch {
    /* private mode / storage denied — the hint is optional, the app is not */
  }
}

export function lastAuthProvider(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Apple's mail relay. Mirrors `isPrivateRelayEmail` in
 *  supabase/functions/_shared/appleIdentity.ts. */
export function isPrivateRelayEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith("@privaterelay.appleid.com");
}

export type SignInMethod = {
  provider: string;
  label: string;
  /** Already attached to this account. */
  linked: boolean;
  /** The one this session actually signed in with. */
  current: boolean;
  /** The address this provider asserts, when it asserts one. */
  email: string | null;
  /** Apple is hiding the address behind its relay. */
  relay: boolean;
};

type Identity = {
  provider: string;
  identity_data?: { email?: string | null } | null;
};

/**
 * The sign-in methods to show in Settings — every one Nuvo offers, in a fixed
 * order, marked linked / current rather than only listing what is missing.
 *
 * `currentProvider` is `user.app_metadata.provider`: the provider of the most
 * recent sign-in, which is the honest answer to "which did I use?".
 */
export function readSignInMethods(
  identities: Identity[] | null | undefined,
  currentProvider: string | null | undefined,
  offered: { google?: boolean; apple?: boolean } = {},
): SignInMethod[] {
  const known = identities ?? [];
  const rows: Array<{ provider: string; show: boolean }> = [
    { provider: "google", show: offered.google !== false },
    { provider: "apple", show: offered.apple !== false },
    // Never offered — there is no "link an email" flow — but shown whenever it
    // exists, because a pane that cannot say "this is the one you used" has
    // failed at the only question it is asked.
    { provider: "email", show: false },
  ];
  return rows
    // An identity that exists is always shown, even if we would not offer to
    // add it — hiding an attached method is how you get "I can't tell what
    // this account is".
    .filter((r) => r.show || known.some((i) => i.provider === r.provider))
    .map((r) => {
      const identity = known.find((i) => i.provider === r.provider);
      const email = identity?.identity_data?.email ?? null;
      return {
        provider: r.provider,
        label: providerRowLabel(r.provider),
        linked: Boolean(identity),
        current: currentProvider === r.provider,
        email,
        relay: r.provider === "apple" && isPrivateRelayEmail(email),
      };
    });
}
