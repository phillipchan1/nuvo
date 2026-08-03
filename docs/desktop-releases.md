# Desktop releases & auto-update

How the native macOS app is built, signed, published, and auto-updated. The app
is a Tauri v2 build of the same `dist/` the web/PWA ships; CI produces a
**notarized universal** DMG and the app updates itself in the background.

## The three repos

1. **`nuvo`** (this repo) — source + the release workflow (`.github/workflows/release.yml`).
2. **`marketing/`** (deploys to nuvo.day) — the "Download for Mac" CTA.
3. **`phillipchan1/nuvo-releases`** — a **public** repo that holds every release's
   DMG, `.app.tar.gz`, `.sig`, and `latest.json`. Installed apps poll
   `releases/latest/download/latest.json`; the marketing link resolves
   `releases/latest/download/Nuvo.dmg`.

## Two independent signing systems (don't conflate them)

- **Tauri updater signature** (minisign keypair) — proves the *update payload* so
  the app will install it. The **public** key lives in `src-tauri/tauri.conf.json`
  → `plugins.updater.pubkey`. The **private** key was generated to
  `~/.tauri/nuvo-updater.key` (outside the repo) and is provided to CI as a secret.
  **Losing it means you can never ship another update to installed apps — back it up.**
- **Apple Developer ID** codesign + notarization — proves the *app* to macOS
  Gatekeeper so it opens with no "unidentified developer" warning. Independent of
  the updater key.

## Cutting a release

Every push to **`master`** builds and publishes a new desktop release automatically
(~6–8 min on macOS). You can also:

- **Version tag:** `git tag v0.2.0 && git push origin v0.2.0` → releases exactly `0.2.0`.
- **Manual:** Actions tab → **Release** → **Run workflow** → releases `<major>.<minor>.<run>`.

Non-tag pushes get version `<major>.<minor>.<run_number>` from `package.json` + the
workflow run counter. Release notes are AI-generated from the commit range by
`scripts/release-notes.mjs` (OpenAI, with a deterministic commit-filter fallback if
`OPENAI_API_KEY` is absent).

> The `nuvo` source repo is **public**, so GitHub Actions minutes are free/unlimited.
> If it's ever made private again, macOS runners bill at 10× included minutes — every
> merge to master will spend ~6–8 min of those.

## One-time setup (required before the first real release)

### 1. Create the releases repo
Create **public** repo `phillipchan1/nuvo-releases` (empty is fine).

### 2. Repository secrets (Settings → Secrets and variables → Actions)

**Build inputs**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — same values the web build uses.
- `RELEASES_TOKEN` — a PAT (fine-grained: `contents:read/write` on `nuvo-releases`)
  used to publish releases + read/write `last-built-sha.txt`.
- `OPENAI_API_KEY` — for AI release notes (`scripts/release-notes.mjs`). Optional
  (falls back to cleaned commit subjects).

**Tauri updater signing**
- `TAURI_SIGNING_PRIVATE_KEY` — the full contents of `~/.tauri/nuvo-updater.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key's password (empty string if none —
  the key was generated with no password, so set this to an empty secret).

**Apple codesign + notarization** (build stays unsigned/ad-hoc if these are absent)
- `APPLE_CERTIFICATE` — base64 of your exported Developer ID Application `.p12`
  (`base64 -i cert.p12 | pbcopy`).
- `APPLE_CERTIFICATE_PASSWORD` — the `.p12` export password.
- `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: Your Name (TEAMID)`.
- Notarization via Apple ID (what the workflow uses — Tauri runs `notarytool` itself):
  - `APPLE_ID` — your Apple Developer account email.
  - `APPLE_PASSWORD` — an **app-specific password** (create at appleid.apple.com →
    Sign-In and Security → App-Specific Passwords; **not** your login password).
  - `APPLE_TEAM_ID` — your 10-char Developer Team ID (Membership page).

> The `.p12` is your **Developer ID Application** certificate exported from
> Keychain Access (needs the Apple Developer Program, $99/yr, Account Holder role).
> Export it: Keychain Access → your "Developer ID Application" cert → right-click →
> Export → `.p12` with a password → `base64 -i cert.p12 | pbcopy`.
>
> Prefer the App Store Connect **API key** instead? Tauri supports it too — swap the
> three `APPLE_ID/PASSWORD/TEAM_ID` vars in `release.yml` for
> `APPLE_API_ISSUER` / `APPLE_API_KEY` (key ID) / `APPLE_API_KEY_PATH`, and add a step
> that writes the `.p8` (from a base64 secret) to that path before the build.

### 3. Back up the updater private key
`~/.tauri/nuvo-updater.key` + its (empty) password. Store it somewhere durable
(password manager). It is unrecoverable and gates every future update.

## What the workflow publishes

Per release, to `nuvo-releases` as GitHub's `--latest`:
- `Nuvo_<version>_universal.dmg` (versioned) **and** `Nuvo.dmg` (stable name for the site link)
- `Nuvo.app.tar.gz` + `Nuvo.app.tar.gz.sig` (the updater payload)
- `latest.json` — `{ version, notes, pub_date, platforms: { darwin-aarch64, darwin-x86_64 } }`,
  both arch keys pointing at the same universal artifact.

## In-app update UX

- `src/lib/appUpdate.ts` — one shared store. Background-polls every 30 min, silently
  downloads a new build, then surfaces an unobtrusive **"Restart to update"** (the
  bottom-right `UpdateToast`). Cascades so a mid-download newer build only restarts once,
  and **keeps polling even after one is staged** — a build that ships while an earlier
  one is just sitting there waiting for a click gets swapped in silently, so restarting
  always lands on the latest instead of restarting once for the stale build and again
  right after for the one that shipped in between.
- Settings → **Desktop app** — running version, a manual **"Check for updates"**, and a
  **"What's new"** history (`src/lib/changelog.ts`, bundled `public/changelog.json` with a
  GitHub Releases API fallback). Shares the store with the toast so they never disagree.

## Rotating the updater key (rare)

Generate a new keypair (`npm run tauri -- signer generate -w ~/.tauri/nuvo-updater.key`),
replace `pubkey` in `tauri.conf.json`, update the `TAURI_SIGNING_*` secrets, and ship.
Note: apps signed with the **old** key can't verify updates signed with the **new** one —
plan a clean reinstall for anyone still on a pre-rotation build.
