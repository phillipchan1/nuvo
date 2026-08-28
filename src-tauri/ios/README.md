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
  to mean different things. Opening capture or chat also has to raise the
  keyboard (D-115): `useRaiseKeyboard` in the SPA, and a once-only
  WKContentView assist swizzle in `NuvoWatchPlugin.load` (Capacitor's
  `_elementDidFocus:userIsInteracting:…`, force interacting). Walking
  `_setKeyboardDisplayRequiresUserAction:` at load is often a no-op —
  the content view is not in the tree yet. Never KVC that key
  (`NSUnknownKeyException` kills launch). A widget capture files to
  Inbox (`captureDefaultDoDate`), not Today inherited from Calendar.

- **`NuvoWatch/`** — the watchOS companion app. watchOS has **no web view**, so
  none of `src/` is reachable: this is native SwiftUI over HTTPS. The rule that
  shapes it is that **the watch computes nothing** — it renders
  `GET /functions/v1/day`, whose payload is built from
  `supabase/functions/_shared/dayShape.ts`, the same module the SPA and the
  agent build a day from. A Swift `readDay` would be a third runtime of the
  planning rules.

  Added to the generated project by `scripts/ios-watch.rb` (called from
  `scripts/ios-postinit.sh`, alongside the widget injector). `NUVO_IOS_WATCH=0`
  skips it. Currently a shell that says it is waiting for a credential — it
  shows nothing about your day on purpose, for the same P7 reason the widgets
  carry no data.

  Two things it cost to get right, both verified locally:
  - The target must be `type: application` on `platform: watchOS`, **not**
    `application.watchapp2`. The latter is the legacy shape where the `.app` is
    a bundle around Apple's WatchKit stub binary; with our own Swift linked in,
    two commands write the same executable and the build fails with *"Multiple
    commands produce …/NuvoWatch.app/NuvoWatch"*.
  - Because a plain `application` gets no inferred "Embed Watch Content" phase,
    the app target's dependency names the destination explicitly
    (`copy: {destination: productsDirectory, subpath: $(CONTENTS_FOLDER_PATH)/Watch}`).
    XcodeGen emits it as a phase called *Embed Dependencies* — grepping for
    "Embed Watch Content" will wrongly tell you it is missing.

  ⚠️ **`day.nuvo.app.watchkitapp` must be registered by hand** in the developer
  portal before a TestFlight export succeeds — an App Store Connect API key can
  create a *profile* but not a new identifier. Same wall the widgets hit.

- **StoreKit IAP** lives in `../plugins/nuvo-iap/`, **not here** — same
  placement rule as the watch bridge: Tauri only compiles Swift that sits
  under a plugin's `ios/` path. The plugin talks StoreKit 1 (delegates, no
  async/await). Product identifiers come from env; localized prices come from
  `SKProduct`. Card checkout does not live here.

- **The credential bridge** lives in `../plugins/nuvo-watch/`, **not here** —
  and that placement is forced, not stylistic. Tauri's only JS→Swift path is a
  plugin crate whose `ios/` directory `tauri_plugin::Builder::ios_path` hands to
  `swift_rs::SwiftLinker`; the Swift is compiled **by cargo** into `libapp.a`
  and the Xcode project never sees it. So nothing about it belongs in
  `ios-watch.rb`, and its Swift cannot live beside `NuvoWatch/`.

  The phone half pushes over `WCSession.updateApplicationContext` (one payload,
  replaced — a queue would deliver dead tokens oldest-first). The watch half is
  `NuvoWatch/SessionStore.swift`: newest-wins by a monotonic stamp, persisted to
  the watch Keychain, and a `revoked: true` tombstone on sign-out deletes it.
  What crosses is a **`connections` bearer token**, never the Supabase refresh
  token — see the plugin's `models.rs` for why that would sign the user out on
  their phone.

- **Next:** wire the watch's Capture and Ask Nuvo to that credential and render
  `GET /functions/v1/day`; then App Intents (capture without opening the app,
  Siri) and the iPhone glance widget over an App Group snapshot.

Full setup, CI, and roadmap: [`docs/ios-releases.md`](../../docs/ios-releases.md).
