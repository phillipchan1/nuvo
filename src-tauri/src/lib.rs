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
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

// Whether the ⌥Space spotlight panel is currently up. Tracked by us — not via
// NSPanel::is_visible(), which reads stale the instant after show.
#[cfg(target_os = "macos")]
static SPOTLIGHT_VISIBLE: AtomicBool = AtomicBool::new(false);

// When the last applicationShouldHandleReopen fired. A ⌥Space summon on a
// ⌘H-hidden app makes macOS unhide+reopen the whole app, and that reopen races
// with our hotkey handler in an unpredictable order — so each side corrects the
// other: the hotkey handler re-hides main if a reopen JUST fired, and the reopen
// handler re-hides main if a summon is already up. Net: ⌥Space never raises main.
#[cfg(target_os = "macos")]
static REOPEN_AT: Mutex<Option<Instant>> = Mutex::new(None);

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
            SPOTLIGHT_VISIBLE.store(false, Ordering::SeqCst);
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
#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        win.open_devtools();
    }
}

// resign-key handler and the hotkey toggle use.
#[cfg(target_os = "macos")]
#[tauri::command]
fn hide_spotlight(app: tauri::AppHandle) {
    SPOTLIGHT_VISIBLE.store(false, Ordering::SeqCst);
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

// Hand off from the ⌥Space panel to the main window: dismiss the panel and bring
// main all the way to the foreground. The panel is non-activating, so a JS
// `show()/setFocus()` can't pull a background app forward — only an AppKit
// activate (surface_main_window) reliably does. Used by a pulled-up record and
// "Open Nuvo". SPOTLIGHT_VISIBLE is cleared FIRST so a racing Reopen surfaces
// main rather than re-hiding it (the ⌥Space-never-raises-main guard).
#[cfg(target_os = "macos")]
#[tauri::command]
fn surface_main(app: tauri::AppHandle) {
    SPOTLIGHT_VISIBLE.store(false, Ordering::SeqCst);
    if let Ok(panel) = app.get_webview_panel("spotlight") {
        panel.hide();
    }
    if let Some(win) = app.get_webview_window("main") {
        surface_main_window(&win);
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn surface_main(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(spot) = app.get_webview_window("spotlight") {
        let _ = spot.hide();
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
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
        .invoke_handler(tauri::generate_handler![open_devtools, hide_spotlight, surface_main])
        .setup(|app| {
            // Reskin the spotlight window into a non-activating NSPanel.
            #[cfg(target_os = "macos")]
            install_spotlight_panel(app.handle());

            // Put the traffic lights where the spine reserves room for them.
            // `trafficLightPosition` in tauri.conf.json does NOT survive here:
            // the config feeds tao's window builder, but wry then installs its
            // own parent view over the window and macOS re-lays the titlebar,
            // which resets the buttons. So we place them ourselves, once the
            // window really exists, and again on resize (AppKit re-lays the
            // titlebar container every time the window changes size).
            #[cfg(target_os = "macos")]
            if let Some(main) = app.get_webview_window("main") {
                place_traffic_lights(&main, true);
                let w = main.clone();
                main.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Resized(_)) {
                        place_traffic_lights(&w, false);
                    }
                });
            }

            // ⌘W on the main window must HIDE it, not destroy it — otherwise the
            // window is gone for good and the dock icon can never bring Nuvo back
            // (Tauri's default close destroys the webview). Hidden, it's restored
            // by the dock-reopen handler below.
            #[cfg(target_os = "macos")]
            if let Some(main) = app.get_webview_window("main") {
                let w = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        order_out(&w);
                    }
                });
            }

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
                                        SPOTLIGHT_VISIBLE.store(false, Ordering::SeqCst);
                                        panel.hide();
                                    } else {
                                        // Mark visible BEFORE showing, so any reopen
                                        // the summon triggers is recognized as ours.
                                        // Capture BEFORE the show — showing the panel
                                        // makes macOS unhide a ⌘H-hidden app (often with
                                        // no reopen at all), and we must undo that.
                                        let was_hidden = app_is_hidden();
                                        SPOTLIGHT_VISIBLE.store(true, Ordering::SeqCst);
                                        if let Some(win) = app.get_webview_window("spotlight") {
                                            position_spotlight(&win); // cursor's screen, not the panel's
                                            let _ = win.emit("spotlight-show", ());
                                        }
                                        panel.show_and_make_key();
                                        // ⌥Space must never raise main. Re-hide it if the
                                        // app was hidden (unhide-on-show, no reopen) OR if a
                                        // reopen raced ahead and already raised it.
                                        if was_hidden {
                                            if let Some(win) = app.get_webview_window("main") {
                                                order_out(&win);
                                            }
                                        }
                                        rehide_main_if_reopen_raced(app);
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
            // Dock-icon reopen (NSApplicationDelegate applicationShouldHandleReopen),
            // also fired when macOS unhides a ⌘H-hidden app to show the ⌥Space panel.
            //   • summon already up → the unhide arrived after the panel showed →
            //     re-hide main (only the panel should be up). The other ordering —
            //     reopen arrives first — is corrected by the hotkey handler, which
            //     reads REOPEN_AT and re-hides main itself.
            //   • no visible windows + no summon → genuine dock click on a minimized
            //     or ⌘W-hidden app → restore it.
            //   • windows already up → ordinary dock click → leave it to macOS.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = _event {
                *REOPEN_AT.lock().unwrap() = Some(Instant::now());
                if SPOTLIGHT_VISIBLE.load(Ordering::SeqCst) {
                    // Unhide arrived after the panel showed → re-hide main.
                    if let Some(win) = _app.get_webview_window("main") {
                        order_out(&win);
                    }
                } else if !has_visible_windows {
                    // Genuine dock click on a minimized / ⌘W-hidden app → restore it.
                    if let Some(win) = _app.get_webview_window("main") {
                        surface_main_window(&win);
                    }
                }
                // else: ordinary dock click with windows already up → leave to macOS.
            }
        });
}

// Place the spotlight on the screen the cursor is on (where the user is
// working), centered horizontally and in the upper third — like Spotlight.
// tao's center() puts it on the panel's assigned screen (often the wrong
// monitor), so we set the frame origin ourselves via AppKit.
#[cfg(target_os = "macos")]
/// Where the buttons sit, in window points.
///
/// NOTE the y is not the distance from the top edge: AppKit keeps the button at
/// y=9 inside the titlebar container, so the gap above it is `y - 9`. Verified
/// against a running window — x=24/47/70, top 9.0pt below the window edge,
/// which centres the cluster in the 32pt band the spine reserves.
/// x lines the cluster up with the Nuvo wordmark's glyphs; y centres it in the
/// band the spine reserves. Points, not CSS px — the buttons are drawn by
/// AppKit and cannot follow the app's `--ui-scale` zoom, which is exactly why
/// the spine sizes its reserve in points too (see index.css).
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_X: f64 = 24.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y: f64 = 24.0;

/// Move the standard window buttons. Same math wry uses internally — grow the
/// titlebar container to `button height + y` and pin it to the top of the
/// window, then lay the buttons out from `x` at their existing spacing — but
/// run at a point nothing overwrites it afterwards.
#[cfg(target_os = "macos")]
fn place_traffic_lights<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>, log: bool) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let Ok(ptr) = win.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    // AppKit is main-thread only; window events can arrive elsewhere.
    let win = win.clone();
    let _ = win.clone().run_on_main_thread(move || {
        let Ok(ptr) = win.ns_window() else { return };
        let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        unsafe {
            let (Some(close), Some(mini)) = (
                ns_window.standardWindowButton(NSWindowButton::CloseButton),
                ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton),
            ) else {
                return;
            };
            let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

            let close_frame = close.frame();
            let spacing = mini.frame().origin.x - close_frame.origin.x;

            // The buttons' grandparent is the titlebar container.
            let Some(container) = close.superview().and_then(|v| v.superview()) else {
                return;
            };
            let mut rect = container.frame();
            let height = close_frame.size.height + TRAFFIC_LIGHT_Y;
            rect.size.height = height;
            rect.origin.y = ns_window.frame().size.height - height;
            container.setFrame(rect);

            let mut buttons = vec![close, mini];
            if let Some(zoom) = zoom {
                buttons.push(zoom);
            }
            for (i, button) in buttons.into_iter().enumerate() {
                let mut frame = button.frame();
                frame.origin.x = TRAFFIC_LIGHT_X + (i as f64) * spacing;
                button.setFrameOrigin(frame.origin);
                // Dev-only, and only on the first placement — a window drag
                // would otherwise spam this on every resize tick. Keeps the
                // geometry checkable instead of inferred from a screenshot.
                #[cfg(debug_assertions)]
                if log {
                    let after = button.frame();
                    eprintln!(
                        "[traffic-lights] button {i}: x={:.1}, top {:.1}pt below the window edge",
                        after.origin.x,
                        height - (after.origin.y + after.size.height)
                    );
                }
            }
        }
    });
}

fn position_spotlight<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    use tauri_nspanel::objc2_app_kit::{NSEvent, NSScreen, NSWindow};
    use tauri_nspanel::objc2_foundation::{MainThreadMarker, NSPoint};

    let Some(mtm) = MainThreadMarker::new() else { return };
    let Ok(ptr) = win.ns_window() else { return };
    // SAFETY: ns_window() hands back this window's live NSWindow*.
    let w: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

    let mouse = NSEvent::mouseLocation();
    let screens = NSScreen::screens(mtm);
    let mut chosen = screens.firstObject();
    let mut i = 0usize;
    while i < screens.count() {
        let s = screens.objectAtIndex(i);
        let f = s.frame();
        if mouse.x >= f.origin.x
            && mouse.x <= f.origin.x + f.size.width
            && mouse.y >= f.origin.y
            && mouse.y <= f.origin.y + f.size.height
        {
            chosen = Some(s);
            break;
        }
        i += 1;
    }
    let Some(screen) = chosen else { return };

    let vf = screen.visibleFrame();
    let wf = w.frame();
    let x = vf.origin.x + (vf.size.width - wf.size.width) / 2.0;
    // macOS y is bottom-up — 0.62 puts the card in the upper third.
    let y = vf.origin.y + (vf.size.height - wf.size.height) * 0.62;
    w.setFrameOrigin(NSPoint { x, y });
}

// Is the whole app currently hidden (⌘H)? Checked before a summon shows the
// panel — because showing it makes macOS unhide the app, which we must undo.
#[cfg(target_os = "macos")]
fn app_is_hidden() -> bool {
    use tauri_nspanel::objc2_app_kit::NSApplication;
    use tauri_nspanel::objc2_foundation::MainThreadMarker;
    MainThreadMarker::new()
        .map(|mtm| NSApplication::sharedApplication(mtm).isHidden())
        .unwrap_or(false)
}

// Order a window out (hide it) via AppKit — used to undo the macOS unhide that a
// ⌥Space summon triggers on a hidden app, so only the floating panel remains.
#[cfg(target_os = "macos")]
fn order_out<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    use tauri_nspanel::objc2_app_kit::NSWindow;
    if let Ok(ptr) = win.ns_window() {
        // SAFETY: ns_window() hands back this window's live NSWindow*.
        let w: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        w.orderOut(None);
    }
}

// A ⌥Space summon never wants to raise the main window. If macOS just unhid the
// app to show us (a reopen fired in the last beat), undo it. Called from the
// hotkey handler right after the panel is shown.
#[cfg(target_os = "macos")]
fn rehide_main_if_reopen_raced<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let raced = REOPEN_AT
        .lock()
        .ok()
        .and_then(|mut g| g.take())
        .map(|t| t.elapsed() < Duration::from_millis(600))
        .unwrap_or(false);
    if raced {
        if let Some(win) = app.get_webview_window("main") {
            order_out(&win);
        }
    }
}

// Bring the main window all the way to the foreground, bypassing tao's guarded
// wrappers (which short-circuit while the window is still miniaturized). Order
// matters: activate the app first, then pull the NSWindow out of the dock and
// make it key + front.
#[cfg(target_os = "macos")]
fn surface_main_window<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    use tauri_nspanel::objc2_app_kit::{NSApplication, NSWindow};
    use tauri_nspanel::objc2_foundation::MainThreadMarker;

    let Some(mtm) = MainThreadMarker::new() else { return };
    let ns_app = NSApplication::sharedApplication(mtm);
    let Ok(ptr) = win.ns_window() else { return };
    // SAFETY: ns_window() hands back this window's live NSWindow*.
    let w: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

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
}
