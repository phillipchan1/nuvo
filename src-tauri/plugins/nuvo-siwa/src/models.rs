use serde::{Deserialize, Serialize};

/// What JS hands down to start an authorization.
///
/// `nonce` is the **SHA-256 hex digest** of a raw nonce JS keeps to itself.
/// Apple embeds this digest in the identity token's `nonce` claim; the raw
/// value goes to Supabase, which hashes it and compares. Sending the same
/// string to both ends is the single most common way this feature fails —
/// Apple accepts it, and Supabase then rejects the token with nothing but an
/// opaque "invalid nonce". See src/lib/appleAuth.ts.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInRequest {
    pub nonce: String,
}

/// One authorization's spoils.
///
/// `email` / `given_name` / `family_name` arrive **only on the very first
/// authorization for this Apple ID + app pair, ever** — every later sign-in
/// returns them as `None`, and the only way back is for the user to revoke
/// Nuvo in Settings → Apple ID. Whatever receives this must persist them on
/// that first callback or they are gone.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleCredential {
    /// False everywhere but iOS. JS falls back to the web OAuth flow.
    pub supported: bool,
    /// The JWT for `supabase.auth.signInWithIdToken`.
    pub identity_token: Option<String>,
    /// Single-use, ~5 minutes. Exchanged server-side for the refresh token that
    /// account deletion revokes (Apple's /auth/revoke). Useless afterwards.
    pub authorization_code: Option<String>,
    /// Apple's stable subject id for this user + team. Survives an email change.
    pub user: Option<String>,
    pub email: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
}
