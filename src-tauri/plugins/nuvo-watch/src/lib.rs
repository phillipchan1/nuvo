//! Hands the Apple Watch a credential, over WatchConnectivity.
//!
//! **Why this exists at all.** watchOS has no web view, so the watch app is
//! native SwiftUI and shares nothing with the SPA — including its session. The
//! Supabase session lives in the iOS webview's `localStorage`, which Swift
//! cannot read. Something has to carry it across, and Tauri's only sanctioned
//! JS→Swift path is a plugin crate whose `ios/` directory is compiled by cargo
//! (via `swift_rs`) straight into `libapp.a`.
//!
//! **What crosses.** Not the Supabase refresh token — see [`models::SessionPayload`]
//! for why that would sign the user out on their phone. A `connections` bearer
//! token instead: durable, revocable, and unable to collide with the phone's
//! own session.
//!
//! **Transport.** `WCSession.updateApplicationContext` rather than
//! `transferUserInfo`: it keeps exactly one payload and replaces the previous
//! one, which is precisely "latest credential wins". A queue would deliver a
//! backlog of dead tokens oldest-first.
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
use desktop::NuvoWatch;
#[cfg(mobile)]
use mobile::NuvoWatch;

pub trait NuvoWatchExt<R: Runtime> {
    fn nuvo_watch(&self) -> &NuvoWatch<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NuvoWatchExt<R> for T {
    fn nuvo_watch(&self) -> &NuvoWatch<R> {
        self.state::<NuvoWatch<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nuvo-watch")
        .invoke_handler(tauri::generate_handler![
            commands::push_session,
            commands::clear_session,
            commands::watch_status,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let nuvo_watch = mobile::init(app, api)?;
            #[cfg(desktop)]
            let nuvo_watch = desktop::init(app, api)?;
            app.manage(nuvo_watch);
            Ok(())
        })
        .build()
}
