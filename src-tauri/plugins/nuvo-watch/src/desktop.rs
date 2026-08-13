use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

/// Desktop stub. Every call succeeds and reports `supported: false`, so the SPA
/// can call the same code path on macOS without branching — and so the macOS
/// release build compiles this crate unchanged.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NuvoWatch<R>> {
    Ok(NuvoWatch(std::marker::PhantomData))
}

// fn() -> R keeps this Send + Sync regardless of R's auto-traits.
pub struct NuvoWatch<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> NuvoWatch<R> {
    pub async fn push_session(&self, _payload: SessionPayload) -> crate::Result<WatchStatus> {
        Ok(WatchStatus::default())
    }

    pub async fn clear_session(&self) -> crate::Result<WatchStatus> {
        Ok(WatchStatus::default())
    }

    pub async fn watch_status(&self) -> crate::Result<WatchStatus> {
        Ok(WatchStatus::default())
    }
}
