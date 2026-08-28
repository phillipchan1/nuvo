use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

/// Desktop stub. Every call succeeds and reports `supported: false`, so the SPA
/// can call the same code path on macOS without branching — and so the macOS
/// release build compiles this crate unchanged.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NuvoSiwa<R>> {
    Ok(NuvoSiwa(std::marker::PhantomData))
}

// fn() -> R keeps this Send + Sync regardless of R's auto-traits.
pub struct NuvoSiwa<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> NuvoSiwa<R> {
    /// Resolves rather than rejects: `supported: false` is the answer, and
    /// appleAuth.ts reads it as "use the web OAuth flow instead". A rejection
    /// here would make the macOS sign-in button look broken.
    pub async fn sign_in(&self, _payload: SignInRequest) -> crate::Result<AppleCredential> {
        Ok(AppleCredential::default())
    }
}
