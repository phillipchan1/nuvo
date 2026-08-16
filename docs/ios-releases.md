# iOS releases & TestFlight

How the native iPhone app is built, signed, and uploaded to TestFlight on every
merge to `master`. Same React SPA and `dist/` as the PWA and macOS app — Tauri
iOS wraps `MobileShell` in a WKWebView.

**Status:** spec, CI scaffolded — complete the one-time Apple setup below, then
every merge to `master` uploads a new TestFlight build automatically.

See also: [`desktop-releases.md`](./desktop-releases.md) (macOS), [`APPLE_WATCH.md`](./APPLE_WATCH.md)
(wrist capture via Shortcuts today).

---

## Delivery channels (one repo, one SPA)

| Channel | Trigger | Update on your phone |
|---|---|---|
| **PWA** (Vercel) | merge → `master` | Service worker (instant-ish on resume) |
| **macOS** (`release.yml`) | merge → `master` | Tauri background updater |
| **iOS TestFlight** (`ios-release.yml`) | merge → `master` | TestFlight app (enable **Automatic Updates**) |

You never manually deploy. Merge to `master`; all three run in parallel.

---

## Architecture

```
src/                     React SPA (MobileShell on phone)
src-tauri/
  tauri.conf.json        identifier com.nuvo.app (macOS desktop)
  tauri.ios.conf.json    identifier day.nuvo.app (iOS / TestFlight)
  gen/apple/             Generated Xcode project (gitignored; CI regenerates)
  ios/                   Committed native code (widgets · watch app · App Intents)
.github/workflows/
  ios-release.yml        Build signed IPA → upload TestFlight
```

**D-012** still holds: one SPA, no router. **D-099** adds a third delivery
channel (native iOS shell) without forking the frontend.

---

## Phase 1 — TestFlight auto-upload (this doc)

Goal: install Nuvo from TestFlight; every merge ships a new build to your phone.

### What CI does

On every push to `master` (and manual **Run workflow**):

1. Stamps version `<major>.<minor>.<commit_count>` — the patch number is the
   total commit count on the built ref (`git rev-list --count HEAD`), the
   same scheme `release.yml` (desktop) uses, so a desktop build and an iOS
   build cut from the same commit always carry the same version and build
   number, regardless of which workflow(s) actually ran for a given push.
2. Checks that build number against App Store Connect
   (`scripts/appstore-next-build-number.mjs`) and bumps past it if a build
   for this exact version was already uploaded — only matters on a manual
   re-run of a commit that already shipped; the normal per-commit case is a
   no-op and iOS stays numbered identically to desktop.
3. `npm ci` → `tauri ios init --ci` (regenerate `gen/apple/`).
4. `scripts/ios-postinit.sh` — encryption export flag, deep-link URL scheme,
   **Nuvo app icons** (copies `src-tauri/icons/ios/` over Tauri's default catalog).
5. `tauri ios build --export-method app-store-connect` — signed IPA.
6. `xcrun altool --upload-app` → App Store Connect → TestFlight.

~15–20 min on `macos-latest`. Concurrency group `ios-testflight` — newer
builds cancel in-progress ones.

### One-time setup checklist

Do these once. After that, merges to `master` are the only deploy step.

#### 1 · Apple Developer Program

Enroll at [developer.apple.com](https://developer.apple.com) ($99/yr). You need
this for TestFlight even for personal use.

#### 2 · App Store Connect app record

1. [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → **+**.
2. **New App** → iOS → name **Nuvo Day** (App Store name; home screen still
   **Nuvo**) → bundle ID **`day.nuvo.app`**
   (must match `src-tauri/tauri.ios.conf.json` → `identifier`).
3. SKU: anything (e.g. `nuvo-ios`). User access: Full Access for yourself.

#### 3 · Register the bundle IDs (if not auto-created)

[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources)
→ **Identifiers** → **+** → App IDs → **`day.nuvo.app`**.

Capabilities for phase 1+: **Push Notifications** and **App Groups**
(`group.day.nuvo.app`). macOS desktop keeps `com.nuvo.app` in the base
`tauri.conf.json`; iOS overrides via `tauri.ios.conf.json`.

**The widget extension needs its own App ID: `day.nuvo.app.widgets`.** Same
place, **+** → App IDs → **App**, description `Nuvo Widgets`, bundle ID
**explicit** `day.nuvo.app.widgets`, no capabilities. An app extension is a
separate signed bundle, so it needs a separate identifier and profile —
`-allowProvisioningUpdates` will happily *create the profile*, but registering a
brand-new identifier through an App Store Connect API key fails in CI:

```
error: exportArchive Automatic signing cannot register bundle identifier "day.nuvo.app.widgets".
error: exportArchive No profiles for 'day.nuvo.app.widgets' were found
```

The app builds and the extension embeds fine — only the export step fails, and
only until the identifier exists. Register it once and re-run; nothing in the
repo needs to change. (If you'd rather ship without widgets in the meantime, set
`NUVO_IOS_WIDGETS=0` on the build step.)

**The watch app needs one too: `day.nuvo.app.watchkitapp`.** Same place, **+** →
App IDs → **App**, description `Nuvo Watch`, bundle ID **explicit**
`day.nuvo.app.watchkitapp`, no capabilities (WatchConnectivity requires none,
and the watch keychain needs no access group). Apple requires a watch app's id
to be *prefixed by its companion's* — that part is a rule, not a convention.
Same failure mode and same fix as the widgets; `NUVO_IOS_WATCH=0` ships without
it meanwhile.

**And the watch face complications need a third: `day.nuvo.app.watchkitapp.complications`.**
Same place, description `Nuvo Watch Complications`, bundle ID **explicit**, no
capabilities. A WidgetKit extension is its own signed bundle, so it needs its own
identifier even though it lives inside the watch app, which lives inside the
phone app. Four identifiers in total:

| Identifier | What it signs |
|---|---|
| `day.nuvo.app` | the iPhone app |
| `day.nuvo.app.widgets` | its lock-screen / Home Screen widgets |
| `day.nuvo.app.watchkitapp` | the watch app |
| `day.nuvo.app.watchkitapp.complications` | the watch face complications |

There is **no separate App Store record.** A companion watch app rides inside
the existing IPA at `Payload/Nuvo.app/Watch/NuvoWatch.app` — one `day.nuvo.app`
record, one TestFlight build, one version stamp, and it installs onto a paired
watch with the phone app. The consequence worth naming: the watch target now
rides *every* iOS release, so a watch build failure fails the whole thing. That
is what the `NUVO_IOS_WATCH=0` escape hatch is for.

#### 4 · App Store Connect API key (upload + automatic signing in CI)

1. App Store Connect → **Users and Access** → **Integrations** → **App Store
   Connect API** → **+** (name: `GitHub Actions`, access: **Admin** or
   **App Manager**).
2. Note **Issuer ID** (above the keys table).
3. Note **Key ID** for the new key.
4. **Download** the `.p8` private key (once only). Base64-encode for GitHub:

   ```bash
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

#### 5 · iOS signing certificate (manual signing fallback)

Tauri CI can use **automatic signing** via the API key above. If automatic
signing fails, provide manual certs (same as
[Tauri iOS signing docs](https://v2.tauri.app/distribute/sign/ios/)):

1. Developer portal → **Certificates** → **+** → **Apple Distribution**.
2. Download, install in Keychain, export as `.p12` with a password.
3. **Profiles** → **+** → **App Store Connect** → App ID `day.nuvo.app` → link
   the Distribution cert → download `.mobileprovision`.
4. Base64 both for secrets (see below).

> **Do not reuse the macOS Developer ID cert** from `release.yml`. App Store /
> TestFlight requires **Apple Distribution**, not Developer ID Application.

#### 6 · GitHub repository secrets

Settings → Secrets and variables → Actions:

| Secret | Required | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Same as web/desktop build |
| `VITE_SUPABASE_ANON_KEY` | yes | Same as web/desktop build |
| `APPLE_TEAM_ID` | yes | 10-char Team ID (Membership page) |
| `APPSTORE_KEY_ID` | yes | App Store Connect API Key ID |
| `APPSTORE_ISSUER_ID` | yes | App Store Connect Issuer ID |
| `APPSTORE_PRIVATE_KEY` | yes | Base64 of the `.p8` file |
| `IOS_CERTIFICATE` | fallback | Base64 of Apple Distribution `.p12` |
| `IOS_CERTIFICATE_PASSWORD` | fallback | `.p12` export password |
| `IOS_MOBILE_PROVISION` | fallback | Base64 of App Store `.mobileprovision` |

`VITE_*` are probably already set for `release.yml`.

#### 7 · TestFlight internal testing

1. App Store Connect → your app → **TestFlight**.
2. After the first CI upload succeeds, the build appears (may take ~5–15 min
   processing).
3. **Internal Testing** → create group → add yourself.
4. Install **TestFlight** on your iPhone → accept the invite → install Nuvo.
5. TestFlight → **Settings** → enable **Automatic Updates**.

Internal testers get builds without App Review. External testers require Beta
App Review (skip for personal dogfooding).

#### 8 · Verify locally (optional, on your Mac)

```bash
# One-time: ensure Xcode + CocoaPods tooling
xcode-select -p
pod --version

# Init + simulator run
export APPLE_DEVELOPMENT_TEAM=<your-team-id>
CI=1 npm run tauri ios init -- --ci
bash scripts/ios-postinit.sh
npm run tauri:ios:dev

# Device / IPA (needs signing configured like CI)
npm run tauri:ios:build
```

---

## Phase 2 — Deep links (capture + chat) — **shipped**

*Status: shipped 2026-08-13 (D-100). Verified in the dev app on both query
spellings; the `nuvo://` leg needs a device or simulator.*

One launch vocabulary, three doors into it:

| Door | URL |
|---|---|
| PWA manifest shortcut (long-press the installed icon) | `/?shortcut=capture` · `/?shortcut=chat` · `/?shortcut=today` |
| iOS widget (below) | `nuvo://capture` · `nuvo://chat` |
| Siri / App Intents (later) | either spelling |

- **`src/lib/shortcuts.ts`** parses both forms into one `Shortcut` union;
  `tests/shortcuts.test.ts` holds it. **Add a door → add it here**, never a second
  parser.
- **`MobileShell.applyShortcut`** is the only applier — capture opens the
  `QuickTaskSheet`, chat opens the Nuvo overlay, today lands on the Tasks/Today
  segment.
- The scheme is registered in `Info.plist` by `ios-postinit.sh`;
  **`tauri-plugin-deep-link`** (registered in `src-tauri/src/lib.rs`, granted in
  `capabilities/default.json`) delivers it. On Apple platforms the plugin listens
  for `RunEvent::Opened`, which is exactly how iOS hands over a custom-scheme URL
  — the plugin's own README talks about universal links, but the custom scheme
  path is the same event.
- Cold launch and resume are **both** handled: `getCurrent()` reads the URL the
  app was started by, `onOpenUrl` catches every one after that. The plugin is
  imported lazily, so the PWA/web bundle never loads it.

Test on a simulator without touching the lock screen:

```bash
xcrun simctl openurl booted nuvo://capture
xcrun simctl openurl booted nuvo://chat
```

---

## Phase 3 — Widgets — **shipped (launchers)**

*Status: shipped 2026-08-13 (D-100) — the launcher half, green through
TestFlight upload on iOS run #14. Siri, App Intents and the glance snapshot are
still ahead; see "Still ahead" below. The `nuvo://` tap itself is still unproven
— it needs a device or `xcrun simctl openurl`.*

Three widgets in one WidgetKit extension, sources in
[`src-tauri/ios/NuvoWidgets/`](../src-tauri/ios/NuvoWidgets/NuvoWidgets.swift):

| Widget | Families | Opens |
|---|---|---|
| **Capture** | `accessoryCircular` · `accessoryInline` · `systemSmall` | `nuvo://capture` |
| **Ask Nuvo** | `accessoryCircular` · `accessoryInline` · `systemSmall` | `nuvo://chat` |
| **Capture · Ask** | `accessoryRectangular` · `systemMedium` | both, as two tap targets |

They are **launchers, not readouts** — they carry no data at all, so there is
nothing on your lock screen that can go quietly stale (P7). The lock-screen faces
are glyph-only because iOS renders accessory widgets in its own monochrome; the
Home Screen faces carry a transcription of the Warm Paper tokens (the CSS
variables can't be read from Swift, so `Paper` in the Swift file is a copy — if
`--accent` moves, move it there too).

### How the target gets into the Xcode project

`gen/apple/` is regenerated on every CI run and Tauri has no hook for extra
targets — but cargo-mobile2 leaves `project.yml` behind and builds the project by
running `xcodegen` against it. So:

1. `tauri ios init --ci` → writes `gen/apple/project.yml`, runs xcodegen.
2. `scripts/ios-postinit.sh` → plist patches, icons, then
   **`scripts/ios-widgets.rb`**.
3. `ios-widgets.rb` adds a `NuvoWidgets` app-extension target to `project.yml`,
   adds it to the app target's dependencies with `embed: true` (that's the
   "Embed App Extensions" phase — without it the extension builds and never
   ships, which looks exactly like a widget that won't appear), and re-runs the
   same `xcodegen generate --no-env --spec project.yml` cargo-mobile2 uses.
4. `tauri ios build` re-uses the existing project — its `ensure_init` only
   regenerates when the app name changed — so the patch survives to the archive.

Details that are load-bearing:

- **Bundle id** is the app's + `.widgets` (`day.nuvo.app.widgets`), read from the
  spec so it can never drift from the app's.
- **Versions must match the host app** or App Store validation rejects the build.
  The script stamps `CFBundleShortVersionString` from `tauri.conf.json` and
  `CFBundleVersion` as `<version>.<BUILD_NUMBER>` — the same pair Tauri gives the
  app (it then runs `xcrun agvtool new-version -all` at archive time, which
  covers every target).
- **Signing** is automatic: Tauri archives with `-allowProvisioningUpdates` and
  the App Store Connect API key, so the extension's App ID and profile are
  created on first upload. Manual signing (the `IOS_*` secrets fallback) would
  need a *second* provisioning profile for `day.nuvo.app.widgets`.
- **Deployment target** is iOS 16 for the extension (accessory families) while
  the app stays at 15. An extension may sit higher than its host.
- **Escape hatch:** `NUVO_IOS_WIDGETS=0` skips the whole step and ships the plain
  app. Nothing else in the build depends on the extension.

### Still ahead

| Feature | Apple API | Nuvo backend |
|---|---|---|
| Lock screen glance ("33m till standup") | WidgetKit + App Group | Main app writes a snapshot from `readDay` / `nowContext` — **with its "as of" stamp visible** (P7) |
| ＋ Capture *without* opening the app | App Intent | `POST /functions/v1/capture` with a connection bearer token |
| "Hey Siri, add to Nuvo" | App Intent + dictation | Same `/capture` endpoint (fast, no LLM) |
| "Hey Siri, ask Nuvo…" | App Intent → `/agent` | Optional; today it opens the app |

**Auth for background capture:** mint a **"This iPhone"** connection in Settings
(inbox:write scope), store the bearer token in the Keychain (shared with the
widget extension via an App Group). Reuses `supabase/functions/capture` — the
same NLP as in-app capture, no agent round-trip.

**Decision N-08** rejected a native watchOS app in favor of Shortcuts → agent.
Native iPhone widgets/Siri are the upgrade path for lock-screen affordances Apple
doesn't give PWAs — not a contradiction.

Evaluate [`tauri-plugin-widgets`](https://github.com/s00d/tauri-plugin-widgets)
for App Group plumbing when the glance lands.

---

## App icons

Two SVG sources, both hand-drawn (no font dependency):

- `src-tauri/app-icon.svg` — the desktop/.icns variant. macOS doesn't mask
  app icons for you, so the squircle + transparent-corner margin is baked in.
- `src-tauri/app-icon-ios.svg` — full-bleed, no corner radius, no
  transparency. iOS (native app icon *and* Safari's "Add to Home Screen"
  webclip) always applies its own mask on top of whatever you give it; this
  is what Apple's HIG asks you to provide.

Regenerate all platform icons (including iOS):

```bash
npm run tauri:icon
```

This runs `tauri icon` against `app-icon.svg` for the desktop/Windows/Android
outputs, then `scripts/gen-ios-icons.sh` renders `app-icon-ios.svg` directly
to every `icons/ios/*.png` size (overwriting whatever `tauri icon` put there),
then `scripts/sync-pwa-icons.sh` copies the results into `public/` — including
`apple-touch-icon.png`, sourced from `icons/ios/AppIcon-60x60@3x.png`, so the
PWA home-screen icon gets the same fix automatically.

`gen-ios-icons.sh` needs `cairosvg` + `Pillow` (`pip3 install cairosvg
pillow`; cairosvg needs the system Cairo library — `brew install cairo` on
macOS).

CI runs `tauri ios init` fresh each build, which emits Tauri's **default**
placeholder catalog. `scripts/ios-postinit.sh` copies `src-tauri/icons/ios/*.png`
into `gen/apple/Assets.xcassets/AppIcon.appiconset/` before the Xcode build, then
verifies none of the copied PNGs carry an alpha channel (see below) before
letting the build continue.

After changing either SVG, run `npm run tauri:icon` and commit the updated
`src-tauri/icons/` tree and `public/` PWA icons.

**Alpha channel.** `tauri icon --ios-color` fills transparent pixels but still
writes RGBA PNGs (alpha ~254–255 — opaque in practice, but the channel is
still present), and App Store Connect rejects **any** iOS app icon that
carries an alpha channel, not just the 1024pt one (error 90717).
`gen-ios-icons.sh` renders straight to RGB, so there's no channel to strip.

**Corner radius / "white border" around the icon.** Filling `app-icon.svg`'s
transparent corners in for iOS (which is what an earlier version of this
pipeline did, via `--ios-color`) doesn't remove the problem, it relocates it:
iOS applies its own squircle mask on top, and its curve doesn't line up with
our hand-drawn `rx="226"` corners, so the filled-in corners peek out from
behind iOS's mask as a visible ring. `app-icon-ios.svg` has no corner radius
at all — a plain full-bleed square — so there's no seam regardless of which
mask curve iOS uses. Never point `gen-ios-icons.sh` (or any future iOS icon
step) at `app-icon.svg` directly.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Workflow fails at signing | Check `APPLE_TEAM_ID`; try manual `IOS_*` secrets |
| "No profiles for day.nuvo.app" | Create App Store provisioning profile; wait for App ID propagation |
| Upload rejected (SDK too old) | Bump `runs-on:` to `macos-26` in `ios-release.yml` |
| Build not in TestFlight | App Store Connect → Activity; check email for compliance questions |
| Wrong icon in TestFlight (Tauri circles) | Run `npm run tauri:icon`; ensure `ios-postinit.sh` copies `icons/ios/` |
| Upload fails: "Invalid large app icon...alpha channel" (90717) | An `icons/ios/*.png` was committed without going through `npm run tauri:icon` (which renders alpha-free via `gen-ios-icons.sh`). Rerun it and recommit; `ios-postinit.sh` now fails the build before upload if this regresses. |
| Visible white/cream ring around the installed icon | `icons/ios/*.png` was generated from `app-icon.svg` (has its own rounded corners) instead of `app-icon-ios.svg` (full-bleed). Rerun `npm run tauri:icon` and recommit. |
| Encryption export questionnaire | `ITSAppUsesNonExemptEncryption=false` set by `ios-postinit.sh` (HTTPS only) |
| Widgets don't appear in the gallery | The extension wasn't embedded. Check the build log for `ios-widgets: added NuvoWidgets…`, and that `nuvo_iOS`'s dependencies in `gen/apple/project.yml` include `target: NuvoWidgets, embed: true` |
| Upload rejected: extension bundle version mismatch | `scripts/ios-widgets.rb` stamps the widget plist from `tauri.conf.json` + `BUILD_NUMBER`. If CI computes the version differently, that script has to learn the same rule |
| `exportArchive Automatic signing cannot register bundle identifier "day.nuvo.app.widgets"` / `No profiles for 'day.nuvo.app.widgets' were found` | The extension's App ID doesn't exist yet and CI can't create it through the API key. Register `day.nuvo.app.widgets` by hand — § One-time setup step 3 — then re-run. With manual `IOS_*` secrets you also need a second App Store provisioning profile for it |
| Same, for `day.nuvo.app.watchkitapp` | Identical cause and fix — register the watch App ID by hand. `NUVO_IOS_WATCH=0` ships without the watch app until you do |
| `Choose a certificate to revoke` / `maximum number of certificates` on **Build the watchOS companion** | CI used to call `-allowProvisioningUpdates` on a fresh runner every push, minting a new **Apple Development: Created via API** cert until the account cap broke all uploads (runs 31895025088+). `scripts/ios-watch-build.sh` now builds **unsigned in CI**; the host app's app-store export carries the nested watch bundle. Revoke stale **Created via API** Development certs in [Certificates](https://developer.apple.com/account/resources/certificates/list) if the portal still complains. Set `NUVO_IOS_WATCH=0` in `ios-release.yml` to ship the plain iPhone app meanwhile |
| `Multiple commands produce .../NuvoWatch.app/NuvoWatch` | The watch target is `application.watchapp2` (legacy: the `.app` wraps Apple's WatchKit stub binary), so the stub copy and our own link both write the executable. A single-target watch app must be `type: application` on `platform: watchOS` — see `scripts/ios-watch.rb` |
| Archive has no watch app inside it | Check the app target's `NuvoWatch` dependency still carries the explicit `copy:` block. A plain `application` gets **no** inferred "Embed Watch Content" phase. Note XcodeGen names the emitted phase **Embed Dependencies** — verify with `grep -A5 'dstSubfolderSpec = 16' …/project.pbxproj`, not by the Xcode phase name |
| `CFBundleVersion of an app extension must match that of its containing parent app` | `scripts/ios-widgets.rb` must stamp the widget with the plain `tauri.conf.json` version, *not* `<version>.<build>` — Tauri's `agvtool new-version -all` adds the build number to both plists between build and archive |
| Anything widget-related blocking a TestFlight build | Set `NUVO_IOS_WIDGETS=0` on the workflow step to ship the plain app while you fix it |
| Widget taps open the app but nothing happens | The deep link isn't arriving: check `deep-link:default` is in `capabilities/default.json` and the plugin is registered in `src-tauri/src/lib.rs`; reproduce with `xcrun simctl openurl booted nuvo://capture` |

---

## Rotating credentials

- **API key:** create new key in App Store Connect, update three `APPSTORE_*`
  secrets, revoke old key.
- **Distribution cert:** annual renewal; re-export `.p12`, update `IOS_*`
  secrets, rebuild.
