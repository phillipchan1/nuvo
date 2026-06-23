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
            // leaves Nuvo in the background; if the main window was also minimized,
            // the dock click looked dead — and tao's WebviewWindow::set_focus()
            // /unminimize() are no-ops or unreliable while the window is still
            // miniaturized. So drive AppKit directly: activate the app, then
            // deminiaturize + key-and-order-front the actual NSWindow.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = _event {
                eprintln!("[nuvo] Reopen (has_visible_windows={has_visible_windows})");
                // The spotlight is alwaysOnTop + floating; a lingering one would
                // sit above the main window. Make sure it's out of the way first.
                if let Ok(panel) = _app.get_webview_panel("spotlight") {
                    if panel.is_visible() {
                        eprintln!("[nuvo] Reopen: spotlight still visible — hiding it");
                        panel.hide();
                    }
                }
                if let Some(win) = _app.get_webview_window("main") {
                    surface_main_window(&win);
                }
            }
        });
}

// Bring the main window all the way to the foreground, bypassing tao's guarded
// wrappers (which short-circuit while the window is still miniaturized). Order
// matters: activate the app first, then pull the NSWindow out of the dock and
// make it key + front.
#[cfg(target_os = "macos")]
fn surface_main_window<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    use tauri_nspanel::objc2_app_kit::{NSApplication, NSWindow};
    use tauri_nspanel::objc2_foundation::MainThreadMarker;

    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[nuvo] surface: not on main thread");
        return;
    };
    let ns_app = NSApplication::sharedApplication(mtm);
    let Ok(ptr) = win.ns_window() else {
        eprintln!("[nuvo] surface: no ns_window");
        return;
    };
    // SAFETY: ns_window() hands back this window's live NSWindow*.
    let w: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

    eprintln!(
        "[nuvo] surface BEFORE: min={} vis={} key={} appActive={}",
        w.isMiniaturized(),
        w.isVisible(),
        w.isKeyWindow(),
        ns_app.isActive()
    );

    // Drive AppKit directly (tao's wrappers short-circuit while miniaturized).
    // deminiaturize → orderFrontRegardless (works even while the app is in the
    // background) → makeKeyWindow, then activate. activateIgnoringOtherApps is
    // deprecated/weakened on macOS 14+, so call the modern activate() too.
    w.deminiaturize(None);
    w.orderFrontRegardless();
    w.makeKeyWindow();
    ns_app.activate();
    #[allow(deprecated)]
    ns_app.activateIgnoringOtherApps(true);

    eprintln!(
        "[nuvo] surface AFTER:  min={} vis={} key={} appActive={}",
        w.isMiniaturized(),
        w.isVisible(),
        w.isKeyWindow(),
        ns_app.isActive()
    );
}
