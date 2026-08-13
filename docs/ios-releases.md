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
  ios/                   Committed native code (widgets + App Intents — phase 2)
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

#### 3 · Register the bundle ID (if not auto-created)

[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources)
→ **Identifiers** → **+** → App IDs → **`day.nuvo.app`**.

Capabilities for phase 1+: **Push Notifications** and **App Groups**
(`group.day.nuvo.app`). macOS desktop keeps `com.nuvo.app` in the base
`tauri.conf.json`; iOS overrides via `tauri.ios.conf.json`.

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

## Phase 2 — Deep links (capture + chat)

The PWA already routes `?shortcut=capture` and `?shortcut=today` in
`MobileShell`. Phase 2 adds:

- URL scheme `nuvo://capture` and `nuvo://chat` (patched in `ios-postinit.sh`).
- `?shortcut=chat` handler → opens Nuvo chat overlay.
- `isTauriIOS()` in `src/lib/platform.ts` — always mount `MobileShell` in the
  native shell (iPad width safety).

---

## Phase 3 — Widgets, Siri, background capture

Lock screen widgets and Siri **cannot** be built in React. They need Swift
extensions in `src-tauri/ios/`:

| Feature | Apple API | Nuvo backend |
|---|---|---|
| Lock screen glance ("33m till standup") | WidgetKit + App Group | Main app writes snapshot from `readDay` / `nowContext` |
| ＋ Capture button on widget | App Intent | `POST /functions/v1/capture` with connection bearer token |
| ✦ Open chat | App Intent → `nuvo://chat` | Opens app |
| "Hey Siri, add to Nuvo" | App Intent + dictation | Same `/capture` endpoint (fast, no LLM) |
| "Hey Siri, ask Nuvo…" | App Intent → `/agent` | Optional; v1 opens app instead |

**Auth for background capture:** mint a **"This iPhone"** connection in Settings
(inbox:write scope), store bearer token in Keychain (shared with widget
extension). Reuses existing `supabase/functions/capture` — same NLP as in-app
capture, no agent round-trip.

**Principle note (P7):** widget data goes stale when the app is closed; show
*when* it was updated — don't pretend it's live.

**Decision N-08** rejected a native watchOS app in favor of Shortcuts → agent.
Native iPhone widgets/Siri are the upgrade path for lock-screen affordances Apple
doesn't give PWAs — not a contradiction.

Evaluate [`tauri-plugin-widgets`](https://github.com/s00d/tauri-plugin-widgets)
for App Group plumbing once phase 3 starts.

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

---

## Rotating credentials

- **API key:** create new key in App Store Connect, update three `APPSTORE_*`
  secrets, revoke old key.
- **Distribution cert:** annual renewal; re-export `.p12`, update `IOS_*`
  secrets, rebuild.
