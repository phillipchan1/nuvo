# Native iOS extensions

Swift code for capabilities Apple does not expose to a WKWebView:

- **Phase 1 (TestFlight shell):** no files here yet — the Tauri-generated Xcode
  project in `gen/apple/` (gitignored) is enough.
- **Phase 2 (deep links):** URL scheme `nuvo://` patched by `scripts/ios-postinit.sh`;
  React handlers in `MobileShell`.
- **Phase 3 (widgets + Siri):** WidgetKit extension + App Intents land here.

Full setup, CI, and roadmap: [`docs/ios-releases.md`](../../docs/ios-releases.md).
