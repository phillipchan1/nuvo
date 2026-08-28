// Persist what Sign in with Apple only ever hands over once.
//
// The iOS app calls this immediately after a successful
// `signInWithIdToken` (src/lib/appleAuth.ts). Authenticated — verify_jwt
// defaults true — so the row is always written for the caller's own account.
//
// Body: { appleUserId, authorizationCode, email, givenName, familyName }
//
// Two irreversible things happen here and nowhere else:
//   • name / email land on their FIRST authorization. Apple returns null for
//     them on every later sign-in, so `mergeAppleProfile` never lets a null
//     overwrite a stored value.
//   • the single-use (~5 min) authorization code is exchanged for a refresh
//     token, which is what account deletion revokes (guideline 5.1.1(v)). Once
//     that code expires there is no way to obtain one.
//
// Best-effort by design: this runs AFTER the user is already signed in, so a
// failure here must never look like a failed sign-in. The next sign-in carries
// a fresh code and retries.
import { admin, deleteSecret, handleOptions, json, requireUser, storeSecret } from "../_shared/admin.ts";
import {
  appleDisplayName,
  exchangeAppleAuthorizationCode,
  mergeAppleProfile,
  readAppleAuthConfig,
} from "../_shared/appleIdentity.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const { data: stored } = await admin
      .from("apple_identities")
      .select("apple_user_id, email, given_name, family_name, refresh_token_secret_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const profile = mergeAppleProfile(stored, {
      appleUserId: body?.appleUserId,
      email: body?.email,
      givenName: body?.givenName,
      familyName: body?.familyName,
    });

    // Exchange the code while it is still alive. Config missing → we simply
    // have no revocable token; deletion says so rather than refusing to run.
    let secretId: string | null = (stored?.refresh_token_secret_id as string | null) ?? null;
    let revocable = Boolean(secretId);
    const code = typeof body?.authorizationCode === "string" ? body.authorizationCode.trim() : "";
    const config = readAppleAuthConfig(Deno.env.toObject());
    if (code && config) {
      const refreshToken = await exchangeAppleAuthorizationCode(config, code).catch(() => null);
      if (refreshToken) {
        const previous = secretId;
        secretId = await storeSecret(`apple_refresh_${user.id}_${Date.now()}`, refreshToken);
        revocable = true;
        // Drop the superseded one only after the new id is safely in hand.
        if (previous) {
          try {
            await deleteSecret(previous);
          } catch {
            /* an orphaned vault row is better than losing the live token */
          }
        }
      }
    }

    const { error } = await admin
      .from("apple_identities")
      .upsert(
        {
          user_id: user.id,
          ...profile,
          refresh_token_secret_id: secretId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) return json({ error: error.message }, 500);

    // Give the account a display name if it has none. Apple is often the only
    // place one ever arrives from, and only on this one call.
    const name = appleDisplayName(profile);
    const existingName = (user.user_metadata ?? {}).full_name;
    if (name && !existingName) {
      await admin.auth.admin
        .updateUserById(user.id, { user_metadata: { ...(user.user_metadata ?? {}), full_name: name } })
        .catch(() => undefined);
    }

    return json({ ok: true, revocable });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
