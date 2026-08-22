use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NuvoIap<R>> {
    Ok(NuvoIap(std::marker::PhantomData))
}

pub struct NuvoIap<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> NuvoIap<R> {
    pub async fn products(&self, _payload: ProductIds) -> crate::Result<ProductsResult> {
        Ok(ProductsResult {
            supported: false,
            products: vec![],
            invalid_ids: vec![],
        })
    }

    pub async fn purchase(&self, _payload: ProductId) -> crate::Result<IapPurchase> {
        Err(crate::Error::Unsupported("StoreKit is iOS only"))
    }

    pub async fn restore(&self) -> crate::Result<RestoreResult> {
        Ok(RestoreResult {
            supported: false,
            transactions: vec![],
        })
    }

    pub async fn manage_subscriptions(&self) -> crate::Result<()> {
        Err(crate::Error::Unsupported("StoreKit is iOS only"))
    }
}
