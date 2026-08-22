use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_nuvo_iap);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NuvoIap<R>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_nuvo_iap)?;
    #[cfg(not(target_os = "ios"))]
    let handle = api.register_android_plugin("day.nuvo.app", "NuvoIapPlugin")?;
    Ok(NuvoIap(handle))
}

pub struct NuvoIap<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NuvoIap<R> {
    pub async fn products(&self, payload: ProductIds) -> crate::Result<ProductsResult> {
        self.0
            .run_mobile_plugin_async("products", payload)
            .await
            .map_err(Into::into)
    }

    pub async fn purchase(&self, payload: ProductId) -> crate::Result<IapPurchase> {
        self.0
            .run_mobile_plugin_async("purchase", payload)
            .await
            .map_err(Into::into)
    }

    pub async fn restore(&self) -> crate::Result<RestoreResult> {
        self.0
            .run_mobile_plugin_async("restore", ())
            .await
            .map_err(Into::into)
    }

    pub async fn manage_subscriptions(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("manageSubscriptions", ())
            .await
            .map_err(Into::into)
    }
}
