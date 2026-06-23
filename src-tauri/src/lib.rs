// The ⌥Space spotlight is converted into a macOS NSPanel with the
// non-activating style mask: it can become the *key window* (so it receives
// Enter / Esc / arrows, not just typed text) WITHOUT activating Nuvo — focus
// stays with whatever app you were in. A plain Tauri window can't do this; a
// borderless, non-key panel only ever gets typed characters, which is why
// Enter/Esc did nothing before.
// `Manager` must be in module scope: the `tauri_panel!` macro expansion calls
// `.app_handle()` (a `Manager` method) here.
#[cfg(target_os = "macos")]
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

#[cfg(target_os = "macos")]
tauri_panel! {
    // The panel class the spotlight window is reskinned into.
    panel!(SpotlightPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
    // Resign-key → dismiss: clicking into another app (or hitting another app's
    // hotkey) hides the panel, so "click away = done" still holds without the
    // old JS blur listener (which an NSPanel's delegate would no longer fire).
    panel_event!(SpotlightPanelDelegate {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

// Turn the pre-declared "spotlight" window into a non-activating panel. Runs
// once at setup; the window itself is declared (hidden) in tauri.conf.json.
#[cfg(target_os = "macos")]
fn install_spotlight_panel(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("spotlight") else {
        return;
    };
    let Ok(panel) = window.to_panel::<SpotlightPanel>() else {
        eprintln!("[nuvo] could not convert spotlight window to an NSPanel");
        return;
    };

    // Float above normal windows, and the non-activating mask keeps the app in
    // the background when the panel takes the keyboard.
    panel.set_level(PanelLevel::Floating.value());
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

    // Show over fullscreen apps and on every Space — a global summon should
    // appear wherever you are, including over a fullscreen deck or call.
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .full_screen_auxiliary()
            .can_join_all_spaces()
            .into(),
    );

    let handler = SpotlightPanelDelegate::new();
    let handle = app.clone();
    handler.window_did_resign_key(move |_| {
        if let Ok(panel) = handle.get_webview_panel("spotlight") {
            panel.hide();
        }
    });
    panel.set_event_handler(Some(handler.as_ref()));
}

// Dismiss the spotlight from the webview. The window is an NSPanel, and a
// panel's visibility is owned by the native panel object — a JS
// `getCurrentWebviewWindow().hide()` no-ops against it (and desyncs
// `panel.is_visible()`, breaking the next ⌥Space toggle). So capture / Esc /
// backdrop dismissal all route here, to the same `panel.hide()` the
// resign-key handler and the hotkey toggle use.
#[cfg(target_os = "macos")]
#[tauri::command]
fn hide_spotlight(app: tauri::AppHandle) {
    if let Ok(panel) = app.get_webview_panel("spotlight") {
        panel.hide();
    }
}

// Other desktops use a plain window (no NSPanel) — hide it directly.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn hide_spotlight(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("spotlight") {
        let _ = win.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![hide_spotlight])
        .setup(|app| {
            // Reskin the spotlight window into a non-activating NSPanel.
            #[cfg(target_os = "macos")]
            install_spotlight_panel(app.handle());

            // Global summon: a system-wide hotkey toggles the floating "spotlight"
            // window — a lightweight command bar that hovers over whatever you're
            // doing, without raising the whole app. Desktop only — iOS/Android
            // can't grant an app a global shortcut. Change the combo on the two
            // lines below; ⌥Space mirrors the launcher feel.
            #[cfg(desktop)]
            {
                use tauri::{Emitter, Manager};
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                let hotkey = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if shortcut != &hotkey || event.state() != ShortcutState::Pressed {
                                return;
                            }

                            // macOS: toggle the NSPanel. show_and_make_key() gives
                            // it keyboard focus without activating the app.
                            #[cfg(target_os = "macos")]
                            {
                                if let Ok(panel) = app.get_webview_panel("spotlight") {
                                    if panel.is_visible() {
                                        panel.hide();
                                    } else {
                                        if let Some(win) = app.get_webview_window("spotlight") {
                                            let _ = win.center();
                                            let _ = win.emit("spotlight-show", ());
                                        }
                                        panel.show_and_make_key();
                                    }
                                }
                            }

                            // Other desktops: a plain focused window (no NSPanel).
                            #[cfg(not(target_os = "macos"))]
                            {
                                if let Some(win) = app.get_webview_window("spotlight") {
                                    if win.is_visible().unwrap_or(false) {
                                        let _ = win.hide();
                                    } else {
                                        let _ = win.center();
                                        let _ = win.show();
                                        let _ = win.set_focus();
                                        let _ = win.emit("spotlight-show", ());
                                    }
                                }
                            }
                        })
                        .build(),
                )?;
                // Non-fatal: if the combo is already claimed (Raycast / Alfred /
                // Spotlight, etc.) registration fails — log it rather than take
                // the whole app down at launch.
                if let Err(err) = app
                    .global_shortcut()
                    .register(Shortcut::new(Some(Modifiers::ALT), Code::Space))
                {
                    eprintln!("[nuvo] could not register global hotkey (already in use?): {err}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Dock-icon click (NSApplicationDelegate applicationShouldHandleReopen).
            // The global ⌥Space panel is a non-activating NSPanel, so summoning it
            // leaves Nuvo running in the background with no key window — after which
            // clicking the dock icon did nothing and the main window wouldn't come
            // forward. Explicitly surface + focus it on reopen.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(win) = _app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        });
}
