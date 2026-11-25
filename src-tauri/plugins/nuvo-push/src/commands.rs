use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NuvoPushExt;

/// Ask iOS for this device's APNs token. Idempotent and cheap after the first
/// call — iOS caches the token, and the SPA re-runs this on every launch so a
/// token that rotated (restore, reinstall) is re-recorded.
#[command]
pub(crate) async fn register<R: Runtime>(app: AppHandle<R>) -> crate::Result<PushRegistration> {
    app.nuvo_push().register().await
}
