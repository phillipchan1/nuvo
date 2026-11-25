use serde::{Deserialize, Serialize};

/// What `register` reports.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRegistration {
    /// This runtime can receive APNs at all (false on desktop).
    pub supported: bool,
    /// The device token, lowercase hex. Absent when iOS refused or timed out.
    #[serde(default)]
    pub token: Option<String>,
    /// `"production"` or `"sandbox"` — which APNs host accepts this token. Read
    /// from the provisioning profile's `aps-environment`; a build with no
    /// embedded profile (App Store, TestFlight) is production.
    #[serde(default)]
    pub environment: Option<String>,
    /// Why there is no token, when there isn't one.
    #[serde(default)]
    pub error: Option<String>,
}
