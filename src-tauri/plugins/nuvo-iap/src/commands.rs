use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NuvoIapExt;

#[command]
pub(crate) async fn products<R: Runtime>(
    app: AppHandle<R>,
    payload: ProductIds,
) -> crate::Result<ProductsResult> {
    app.nuvo_iap().products(payload).await
}

#[command]
pub(crate) async fn purchase<R: Runtime>(
    app: AppHandle<R>,
    payload: ProductId,
) -> crate::Result<IapPurchase> {
    app.nuvo_iap().purchase(payload).await
}

#[command]
pub(crate) async fn restore<R: Runtime>(app: AppHandle<R>) -> crate::Result<RestoreResult> {
    app.nuvo_iap().restore().await
}

#[command]
pub(crate) async fn manage_subscriptions<R: Runtime>(app: AppHandle<R>) -> crate::Result<()> {
    app.nuvo_iap().manage_subscriptions().await
}
