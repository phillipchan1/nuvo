use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_nuvo_watch);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NuvoWatch<R>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_nuvo_watch)?;
    // Android has no counterpart — there is no watch to hand anything to.
    #[cfg(not(target_os = "ios"))]
    let handle = api.register_android_plugin("day.nuvo.app", "NuvoWatchPlugin")?;
    Ok(NuvoWatch(handle))
}

pub struct NuvoWatch<R: Runtime>(PluginHandle<R>);

// Method names are camelCase: they map to the @objc methods on the Swift side.
// The Rust/JS command names stay snake_case.
impl<R: Runtime> NuvoWatch<R> {
    pub async fn push_session(&self, payload: SessionPayload) -> crate::Result<WatchStatus> {
        self.0
            .run_mobile_plugin_async("pushSession", payload)
            .await
            .map_err(Into::into)
    }

    pub async fn clear_session(&self) -> crate::Result<WatchStatus> {
        self.0
            .run_mobile_plugin_async("clearSession", ())
            .await
            .map_err(Into::into)
    }

    pub async fn watch_status(&self) -> crate::Result<WatchStatus> {
        self.0
            .run_mobile_plugin_async("watchStatus", ())
            .await
            .map_err(Into::into)
    }
}
