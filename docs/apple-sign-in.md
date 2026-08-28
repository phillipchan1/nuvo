# Sign in with Apple

**Status: shipped in code, blocked on the operator steps in §1–§4 below.**
Nothing in this document is something Claude can do for you — every step needs
your Apple Developer and Supabase logins.

## Why it is not optional

App Store Review guideline **4.8** ("Login Services"): an app that offers a
third-party or social login must also offer an equivalent privacy-focused
option, and Sign in with Apple is the one Apple accepts. The exemption is for
apps that use *only* their own account system. Nuvo offers **Continue with
Google**, so it forfeits that exemption. An iOS build without Sign in with Apple
is a 4.8 rejection, and this is what blocks the 1.0 submission.

Two more rules ride along:

- The button must use Apple's own appearance and wording, **at least as
  prominent** as the other options (`.apple-signin` in `src/index.css`, rendered
  first in `src/components/Login.tsx`).
- Guideline **5.1.1(v)** already required in-app account deletion (shipped —
  `docs/account-deletion.md`). For a Sign-in-with-Apple account, deletion must
  also **revoke the Apple token** via Apple's `/auth/revoke`. That is its own
  rejection reason. It is wired into `supabase/functions/delete-account`, and it
  is a no-op until §3 below is done.

---

## 1 · Apple Developer portal — enable the capability

Without this, the build does not merely lack the feature: **code signing
fails**, with

```
Provisioning profile "…" doesn't include the com.apple.developer.applesignin entitlement.
```

1. <https://developer.apple.com/account/resources/identifiers/list> → the App ID
   **`day.nuvo.app`**.
2. Tick **Sign In with Apple**. Leave it as **Enable as a primary App ID**
   (Nuvo has no grouped apps).
3. Save. Automatic signing in CI regenerates the profile on the next run; a
   *manual* signing setup (`IOS_MOBILE_PROVISION`) needs the profile
   **regenerated and the secret replaced** — see `docs/ios-releases.md` §5.

Local escape hatch while this is pending: `NUVO_IOS_SIWA=0 bash
scripts/ios-postinit.sh` builds without the entitlement. Never for a release —
that is the 4.8 rejection.

## 2 · Services ID + key — only for the web / desktop path

The **native iOS** path needs none of this. It talks to
`ASAuthorizationController` directly and Supabase verifies the resulting
identity token against the **bundle id**.

The redirect path (`app.nuvo.day` in a browser, the macOS app, and **identity
linking on every platform** — see §5) needs a Services ID:

1. Identifiers → **+** → **Services IDs** → description "Nuvo Web",
   identifier **`day.nuvo.app.web`**.
2. Configure → Sign In with Apple → primary App ID `day.nuvo.app`.
   - **Domains:** `<project-ref>.supabase.co`
   - **Return URLs:** `https://<project-ref>.supabase.co/auth/v1/callback`
   These are Supabase's, not Nuvo's — Apple redirects to Supabase, which then
   redirects to the app.
3. Keys → **+** → name "Nuvo Sign in with Apple" → tick **Sign In with Apple** →
   configure with primary App ID `day.nuvo.app` → **Download the `.p8`**. Apple
   lets you download it **once**. Note the **Key ID** and your **Team ID**.

## 3 · Supabase — Authentication → Providers → Apple

1. Toggle **Apple** on.
2. **Client IDs**: `day.nuvo.app` — and `day.nuvo.app.web` too if you did §2.
   This list is what makes the *native* flow work; a missing bundle id here is
   the whole feature failing with an opaque token error.
3. **Secret Key (for OAuth)** — only for the redirect path: paste the `.p8`
   contents, with the Services ID as client id, per Supabase's form.
4. **Authentication → URL Configuration → Redirect URLs** must list
   `tauri://localhost` (it already does for Google). An unlisted value is not an
   error — Supabase silently falls back to the Site URL and strands the session
   on the wrong origin. `src/lib/authRedirect.ts` documents that trap in full.
5. **Authentication → Settings → Allow manual linking: ON.** This is what makes
   `supabase.auth.linkIdentity()` work at all; the existing "Link Google" button
   needs it too. Without it, Settings → Account → Link Apple returns an error.

### Secrets for the revoke (Supabase → Edge Functions → Secrets)

Required for account deletion to actually revoke Apple's grant. Without them the
wipe still completes and reports `appleRevoked: false`.

```
APPLE_SIWA_TEAM_ID=<your 10-char Team ID>
APPLE_SIWA_KEY_ID=<the Key ID from §2 step 3>
APPLE_SIWA_PRIVATE_KEY=<the whole .p8 file contents, BEGIN/END lines included>
# Optional. Defaults to APPLE_BUNDLE_ID, which is right for the native flow —
# a native authorization code is issued against the BUNDLE ID, and Apple
# rejects an exchange or a revoke that presents a different client_id.
# APPLE_SIWA_CLIENT_ID=day.nuvo.app
```

`APPLE_BUNDLE_ID` is already set for StoreKit (`docs/billing-setup.md` §11).

## 4 · Deploy

```bash
supabase db push                       # migration 76 — public.apple_identities
supabase functions deploy apple-identity
supabase functions deploy delete-account
```

Optional, and only after §2 + §3 step 3 are done — this turns the button on for
the **web and macOS** builds. Native iOS ignores it.

```
VITE_APPLE_AUTH=1
```

Set it in Vercel (and as a GitHub secret if you want it in the desktop build).
Leave it unset and the web keeps showing exactly Google + email code, while
iOS shows Apple regardless.

---

## 5 · Two accounts, one person — the part that bites

Supabase mints a user per **identity**, and folds two identities onto one
account only when they share a **verified email**.

| What the user does | What happens |
| --- | --- |
| Google `ada@example.com`, later Apple **Share My Email** → `ada@example.com` | One account. Same UUID, same data, two identities. Nothing to do. |
| Google `ada@example.com`, later Apple **Hide My Email** → `abc123@privaterelay.appleid.com` | **Two accounts.** The addresses genuinely differ, so nothing can match them — not Supabase, not us. The second one is empty. |
| Links Apple from Settings → Account first | One account, always — linking attaches an identity to the UUID that is already signed in. |

The relay case cannot be detected after the fact: the only thing the two
accounts share is a person. So the app **prevents** rather than repairs:

- **Login** says what this device used last (`src/lib/authProviders.ts` keeps it
  in `localStorage`, and `useAuth` writes it on every successful sign-in,
  whichever path).
- **Settings → Account → Sign-in methods** lists every method with its state —
  linked, which address it asserts, whether Apple is relaying it, and which one
  this session actually signed in with (`app_metadata.provider`).
- Unlinked methods say plainly that using them starts a separate account.

**There is deliberately no account merge.** Moving one tenant's rows into
another is a data migration with real loss modes, for a case that linking
prevents outright. Someone who does land on a fresh empty account should
**delete it** (Settings → Account → Delete account, which also revokes Apple)
and then sign in with their original method and link Apple from Settings.

## 6 · How it is built

| Piece | Where |
| --- | --- |
| Entitlement (committed, reviewable) | `src-tauri/ios/Nuvo.entitlements` |
| Merges it into the generated target's `entitlements.properties`, then verifies the rendered file | `scripts/ios-siwa.rb`, run from `scripts/ios-postinit.sh` **before** the PlistBuddy patches |
| Native bridge (Rust + Swift, compiled into `libapp.a` by swift-rs) | `src-tauri/plugins/nuvo-siwa/` |
| Registered once, unconditionally | `src-tauri/src/lib.rs`, next to `tauri_plugin_nuvo_iap::init()` |
| IPC permission | `src-tauri/capabilities/default.json` → `nuvo-siwa:default` |
| SPA | `src/lib/appleAuth.ts` · `src/lib/authProviders.ts` · `Login.tsx` · `SettingsModal.tsx` |
| Server | `supabase/functions/apple-identity/` · `_shared/appleIdentity.ts` · `delete-account/` · migration 76 |
| Tests | `tests/apple-sign-in.test.ts` |

### Why the entitlement is merged, not pointed at

The obvious patch — setting `settings.base.CODE_SIGN_ENTITLEMENTS` to the
committed file — **does not work, and does not say so.** XcodeGen's
`targets.<t>.entitlements` key owns that build setting and overwrites it, so the
generated project kept pointing at Tauri's own `nuvo_iOS.entitlements`, which is
an empty `<dict/>`. The build would have signed cleanly, shipped with no
entitlement, and been rejected under 4.8 with nothing anywhere explaining why.

So `ios-siwa.rb` reads the committed plist, merges its keys into the spec's
`entitlements.properties` (which is the input xcodegen actually renders from),
and then **re-reads the rendered file and the pbxproj** to confirm the key
survived. That verification is the part that matters — the generator reported
success in the broken case too.

### The nonce — the one thing that fails

JS mints a raw nonce, sends Apple its **SHA-256 hex digest**, and sends
Supabase the **raw** value; Supabase hashes it and compares against the token's
`nonce` claim. Send the same string to both and Apple is perfectly happy while
Supabase rejects the token with nothing but an opaque error. The hashing happens
in `src/lib/appleAuth.ts` and **nowhere else** — `NuvoSiwaPlugin.swift`
deliberately never hashes, so the two ends cannot drift apart. A test asserts
that.

### Name and email arrive exactly once, ever

Apple populates them on the **first authorization for an Apple ID + app pair**
and never again; the only way back is the user revoking Nuvo in Settings →
Apple ID. `apple-identity` persists them on that first callback, and
`mergeAppleProfile` refuses to let a later `null` overwrite a stored value.

The email may be a `@privaterelay.appleid.com` alias — mail still reaches the
user, but it is not their real address. Anything that emails them tolerates it.

### The revoke token

Deletion needs a token Apple will accept at `/auth/revoke`, and the only way to
get one is exchanging the **single-use, ~5-minute** authorization code at
sign-in. `apple-identity` does that immediately and stores the refresh token in
`vault.secrets` (`public.apple_identities.refresh_token_secret_id`). Every
native sign-in mints a fresh code, so a failed exchange self-heals on the next
one.

## 7 · Verifying

`checks.yml` never compiles Rust. Before pushing anything under `src-tauri/`:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --lib --release
cargo check --manifest-path src-tauri/Cargo.toml --lib --release --target aarch64-apple-ios
```

Then, and this is the part that only CI can prove: **signing is where the
entitlement is validated.** A green local compile with §1 not done still fails
in `ios-release.yml`. Watch that run.

On device (TestFlight):

1. Tap **Sign in with Apple** → Apple's sheet → Face ID. You land in the app.
2. Settings → Account → Sign-in methods shows **Apple · Signed in with this**.
3. Delete the account. The response carries `appleRevoked: true`, and Nuvo
   disappears from **Settings → Apple ID → Sign in with Apple**.

## 8 · Troubleshooting

| Symptom | Cause |
| --- | --- |
| `doesn't include the com.apple.developer.applesignin entitlement` | §1 not done, or the manual provisioning profile predates it. |
| `ios-siwa: … is missing … after generation` | The script caught xcodegen not rendering the entitlement. Do not skip past it — a build from that project signs cleanly and is rejected under 4.8. |
| Sign-in fails with an opaque token / nonce error | The bundle id is missing from Supabase's **Client IDs** (§3.2), or something hashed the nonce twice. |
| `Unsupported provider: provider is not enabled` | Apple is off in Supabase, or `VITE_APPLE_AUTH=1` is set without §2/§3. |
| "Link Apple" errors immediately | **Allow manual linking** is off (§3.5). |
| A second, empty account after signing in with Apple | Apple's Hide My Email. §5 — delete it and link instead. |
| `appleRevoked: false` on deletion | The `APPLE_SIWA_*` secrets are missing, or that account never signed in natively (no authorization code was ever captured). |
