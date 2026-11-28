use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

/// Desktop stub: reports `supported: false`. The Mac app reminds you through
/// tauri-plugin-notification while it runs (⌘W hides it; it doesn't quit).
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NuvoPush<R>> {
    Ok(NuvoPush(std::marker::PhantomData))
}

// fn() -> R keeps this Send + Sync regardless of R's auto-traits.
pub struct NuvoPush<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> NuvoPush<R> {
    pub async fn register(&self) -> crate::Result<PushRegistration> {
        Ok(PushRegistration::default())
    }
}
