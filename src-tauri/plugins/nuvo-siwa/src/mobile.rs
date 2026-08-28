use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_nuvo_siwa);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NuvoSiwa<R>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_nuvo_siwa)?;
    // Android has no counterpart — Sign in with Apple there is the web flow,
    // which needs no native bridge.
    #[cfg(not(target_os = "ios"))]
    let handle = api.register_android_plugin("day.nuvo.app", "NuvoSiwaPlugin")?;
    Ok(NuvoSiwa(handle))
}

pub struct NuvoSiwa<R: Runtime>(PluginHandle<R>);

// Method names are camelCase: they map to the @objc methods on the Swift side.
// The Rust/JS command names stay snake_case.
impl<R: Runtime> NuvoSiwa<R> {
    pub async fn sign_in(&self, payload: SignInRequest) -> crate::Result<AppleCredential> {
        self.0
            .run_mobile_plugin_async("signIn", payload)
            .await
            .map_err(Into::into)
    }
}
