# Committed iOS Xcode project

Xcode Cloud archives this folder. It used to be gitignored and rebuilt by
`tauri ios init` on every GitHub Actions run; Cloud needs a project that
already exists after clone, with the widget target and entitlements already
patched in.

**Scheme: `nuvo_iOS`.** Point the Xcode Cloud workflow at
`src-tauri/gen/apple/nuvo.xcodeproj` and that scheme.

`project.yml` is the source of truth (cargo-mobile2 / XcodeGen). The
`.xcodeproj` matches it. Regenerating:

```bash
xcodegen generate --no-env --spec src-tauri/gen/apple/project.yml
```

Do not set `CFBundleVersion` on the app — Xcode Cloud's build number
(`CURRENT_PROJECT_VERSION`) wins. The widget plist uses
`$(CURRENT_PROJECT_VERSION)` so the two stay in lockstep.

The watch app is **not** in this committed project. GitHub Actions still
injects it via `scripts/ios-watch.rb` when `NUVO_IOS_WATCH=1`. Xcode Cloud
defaults to `NUVO_IOS_WATCH=0` and skips it.

Xcode Cloud scripts live in `ci_scripts/`.
