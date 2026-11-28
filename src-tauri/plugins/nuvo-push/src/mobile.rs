use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_nuvo_push);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NuvoPush<R>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_nuvo_push)?;
    // No Android build ships; FCM would be its own piece of work.
    #[cfg(not(target_os = "ios"))]
    let handle = api.register_android_plugin("day.nuvo.app", "NuvoPushPlugin")?;
    Ok(NuvoPush(handle))
}

pub struct NuvoPush<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NuvoPush<R> {
    pub async fn register(&self) -> crate::Result<PushRegistration> {
        self.0
            .run_mobile_plugin_async("register", ())
            .await
            .map_err(Into::into)
    }
}
