//! StoreKit 1 bridge for auto-renewable subscriptions on the iOS binary.
//!
//! Desktop every command reports `supported: false`. The SPA needs no
//! platform branch to call this, and the macOS build compiles unchanged.
//! Swift uses StoreKit 1 delegates (no async/await) — see Package.swift.

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
use desktop::NuvoIap;
#[cfg(mobile)]
use mobile::NuvoIap;

pub trait NuvoIapExt<R: Runtime> {
    fn nuvo_iap(&self) -> &NuvoIap<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NuvoIapExt<R> for T {
    fn nuvo_iap(&self) -> &NuvoIap<R> {
        self.state::<NuvoIap<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nuvo-iap")
        .invoke_handler(tauri::generate_handler![
            commands::products,
            commands::purchase,
            commands::restore,
            commands::manage_subscriptions,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let nuvo_iap = mobile::init(app, api)?;
            #[cfg(desktop)]
            let nuvo_iap = desktop::init(app, api)?;
            app.manage(nuvo_iap);
            Ok(())
        })
        .build()
}
