//! The iPhone's address for background reminders (D-260).
//!
//! **Why.** The native iOS shell has no service worker, so Web Push can never
//! reach it. Apple's own push service (APNs) can — through the same server
//! dispatcher that already serves Web Push, so a reminder is still claimed once
//! per person and an open app still wins (D-105).
//!
//! **What this does.** One command, `register`: ask iOS for the device token and
//! say which APNs environment it belongs to. It asks for nothing else — the
//! notification permission prompt belongs to `tauri-plugin-notification`, and
//! this plugin never touches `UNUserNotificationCenter`'s delegate (that plugin
//! owns it, for foreground presentation and taps).
//!
//! On desktop the command reports `supported: false`, so the SPA needs no
//! platform branch and the macOS build compiles this unchanged.

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
use desktop::NuvoPush;
#[cfg(mobile)]
use mobile::NuvoPush;

pub trait NuvoPushExt<R: Runtime> {
    fn nuvo_push(&self) -> &NuvoPush<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NuvoPushExt<R> for T {
    fn nuvo_push(&self) -> &NuvoPush<R> {
        self.state::<NuvoPush<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nuvo-push")
        .invoke_handler(tauri::generate_handler![commands::register])
        .setup(|app, api| {
            #[cfg(mobile)]
            let nuvo_push = mobile::init(app, api)?;
            #[cfg(desktop)]
            let nuvo_push = desktop::init(app, api)?;
            app.manage(nuvo_push);
            Ok(())
        })
        .build()
}
