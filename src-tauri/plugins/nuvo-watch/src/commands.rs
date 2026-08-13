use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NuvoWatchExt;

/// Hand the wrist a credential. Safe to call on every token change: the watch
/// keeps only the newest context.
#[command]
pub(crate) async fn push_session<R: Runtime>(
    app: AppHandle<R>,
    payload: SessionPayload,
) -> crate::Result<WatchStatus> {
    app.nuvo_watch().push_session(payload).await
}

/// Sign the watch out. Called when the phone signs out — a signed-out phone must
/// not leave a live credential on the wrist.
#[command]
pub(crate) async fn clear_session<R: Runtime>(app: AppHandle<R>) -> crate::Result<WatchStatus> {
    app.nuvo_watch().clear_session().await
}

#[command]
pub(crate) async fn watch_status<R: Runtime>(app: AppHandle<R>) -> crate::Result<WatchStatus> {
    app.nuvo_watch().watch_status().await
}
