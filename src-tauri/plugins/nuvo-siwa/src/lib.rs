//! Sign in with Apple, on the iOS binary.
//!
//! **Why this exists.** App Store guideline 4.8: an app offering a third-party
//! sign-in (Nuvo offers Google) must also offer Sign in with Apple. The only
//! API for it is `ASAuthorizationController`, which is Swift, and Tauri v2's
//! only sanctioned JS→Swift path is a plugin crate whose `ios/` directory
//! cargo compiles (via `swift_rs`) straight into `libapp.a`.
//!
//! **What crosses.** Apple's identity token, its single-use authorization
//! code, and — on the first authorization only — the name and email. No
//! Supabase session: the token is exchanged in JS via
//! `supabase.auth.signInWithIdToken`, so this plugin never holds a credential
//! that outlives the call.
//!
//! **The nonce.** JS keeps a raw nonce and hands this plugin its SHA-256 hex
//! digest, which Swift sets as `ASAuthorizationAppleIDRequest.nonce`; the raw
//! value goes to Supabase. Sending the same string to both is the classic
//! failure — Apple accepts it and Supabase rejects the token opaquely.
//!
//! **Entitlement.** `com.apple.developer.applesignin` reaches the build
//! through `src-tauri/ios/Nuvo.entitlements` + `scripts/ios-siwa.rb`, and it
//! also has to be enabled on the App ID in the Apple Developer portal or
//! signing fails outright. See `docs/apple-sign-in.md`.
//!
//! On desktop every call is a no-op reporting `supported: false`, so the SPA
//! needs no platform branch and the macOS build compiles this unchanged.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::NuvoSiwa;
#[cfg(mobile)]
use mobile::NuvoSiwa;

pub trait NuvoSiwaExt<R: Runtime> {
    fn nuvo_siwa(&self) -> &NuvoSiwa<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NuvoSiwaExt<R> for T {
    fn nuvo_siwa(&self) -> &NuvoSiwa<R> {
        self.state::<NuvoSiwa<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nuvo-siwa")
        .invoke_handler(tauri::generate_handler![commands::sign_in])
        .setup(|app, api| {
            #[cfg(mobile)]
            let nuvo_siwa = mobile::init(app, api)?;
            #[cfg(desktop)]
            let nuvo_siwa = desktop::init(app, api)?;
            app.manage(nuvo_siwa);
            Ok(())
        })
        .build()
}
