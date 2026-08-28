use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NuvoSiwaExt;

/// Present Apple's sheet and return the credential it yields.
///
/// Rejects when the user cancels — JS treats that as silence, not an error
/// worth a toast.
#[command]
pub(crate) async fn sign_in<R: Runtime>(
    app: AppHandle<R>,
    payload: SignInRequest,
) -> crate::Result<AppleCredential> {
    app.nuvo_siwa().sign_in(payload).await
}
