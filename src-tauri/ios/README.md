# Native iOS extensions

Swift code for capabilities Apple does not expose to a WKWebView. Everything
here is committed and reviewable; the Xcode project that consumes it
(`../gen/apple/`) is generated and gitignored.

- **`NuvoWidgets/`** — the WidgetKit extension: lock-screen and Home Screen
  launchers for the phone's two floating actions, **Capture** (`nuvo://capture`)
  and **Ask Nuvo** (`nuvo://chat`). No data on purpose — see the header comment
  in `NuvoWidgets.swift`.

  The target is added to the generated project by `scripts/ios-widgets.rb`
  (called from `scripts/ios-postinit.sh`), which patches `project.yml` and
  re-runs xcodegen. `NUVO_IOS_WIDGETS=0` skips it.

- **Deep links** — the `nuvo://` scheme is registered in `Info.plist` by
  `scripts/ios-postinit.sh` and delivered by `tauri-plugin-deep-link`. The
  vocabulary both sides share lives in `src/lib/shortcuts.ts`; a widget that
  opens capture and a long-pressed app icon that opens capture must not be able
  to mean different things.

- **Next:** App Intents (capture without opening the app, Siri) and the glance
  widget over an App Group snapshot.

Full setup, CI, and roadmap: [`docs/ios-releases.md`](../../docs/ios-releases.md).
