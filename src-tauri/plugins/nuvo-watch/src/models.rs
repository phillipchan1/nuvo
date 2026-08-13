use serde::{Deserialize, Serialize};

/// What the phone hands the watch.
///
/// **Deliberately not the Supabase refresh token.** GoTrue rotates refresh
/// tokens and runs reuse detection: once the phone refreshes `R → R′`, a copy of
/// `R` on the watch is revoked, and presenting it after the reuse interval is
/// treated as a compromised-token replay that revokes the whole token family —
/// signing the user out on the *phone*. A watch that spends hours out of range
/// while the phone refreshes hourly would hit that on an ordinary day.
///
/// So the durable credential is a **connection token** (`public.connections`):
/// it never expires, never rotates, is revocable from Settings → Apps & devices,
/// and cannot collide with the phone's own session.
///
/// `access_token` exists only for the first milestone — enough to prove a value
/// crosses the bridge before the connection-minting path is wired to the watch.
/// It expires in about an hour and the watch must not try to refresh it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPayload {
    /// Supabase project URL. Shipped in the payload so the watch needs no
    /// build-time env injection — `VITE_*` is a Vite-time substitution Swift
    /// cannot see.
    pub url: String,
    /// The anon key, required as the `apikey` header on every PostgREST and
    /// edge-function call. Safe to embed; it is already baked into the web bundle.
    pub anon_key: String,
    /// The durable credential. Preferred when present.
    #[serde(default)]
    pub connection_token: Option<String>,
    /// Short-lived Supabase access token — milestone only, never refreshed.
    #[serde(default)]
    pub access_token: Option<String>,
    pub user_id: String,
    /// Monotonic stamp. The watch ignores any context not newer than the one it
    /// holds, because WatchConnectivity can deliver the same context twice.
    pub issued_at: i64,
}

/// What the phone can tell the caller about the wrist.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    /// WatchConnectivity exists on this device at all (false on desktop/iPad).
    pub supported: bool,
    /// A watch is paired with this phone.
    pub paired: bool,
    /// Our watch app is installed on it.
    pub installed: bool,
    /// The watch is reachable *right now* (app in foreground). Delivery does not
    /// require this — `updateApplicationContext` is queued for later.
    pub reachable: bool,
}
