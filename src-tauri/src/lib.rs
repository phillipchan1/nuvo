#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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
                            if shortcut == &hotkey && event.state() == ShortcutState::Pressed {
                                if let Some(panel) = app.get_webview_window("spotlight") {
                                    if panel.is_visible().unwrap_or(false) {
                                        let _ = panel.hide();
                                    } else {
                                        let _ = panel.center();
                                        let _ = panel.show();
                                        let _ = panel.set_focus();
                                        let _ = panel.emit("spotlight-show", ());
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
