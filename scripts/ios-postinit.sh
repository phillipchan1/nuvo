#!/usr/bin/env bash
# Patches the generated Xcode project after `tauri ios init`. Safe to re-run.
# Called from CI (.github/workflows/ios-release.yml) and local iOS builds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="${ROOT}/src-tauri/gen/apple/nuvo_iOS/Info.plist"

if [ ! -f "$PLIST" ]; then
  echo "ios-postinit: Info.plist not found at $PLIST — run 'npm run tauri ios init -- --ci' first"
  exit 1
fi

# Lock-screen / Home Screen widgets — adds the WidgetKit extension target to the
# generated project and regenerates it via `xcodegen generate`. Must run FIRST:
# xcodegen owns nuvo_iOS/Info.plist (project.yml declares `info.path` +
# `info.properties` for that target), so regenerating rewrites the file from
# project.yml's properties and silently drops anything patched below it —
# ITSAppUsesNonExemptEncryption, CFBundleURLTypes, the orientation lock all
# vanished this way (App Store Connect kept flagging every build "Missing
# Compliance" because of it). NUVO_IOS_WIDGETS=0 ships the plain app if the
# extension ever blocks a build.
if [ "${NUVO_IOS_WIDGETS:-1}" = "1" ]; then
  ruby "${ROOT}/scripts/ios-widgets.rb"
else
  echo "ios-widgets: skipped (NUVO_IOS_WIDGETS=0)"
fi

# The watchOS companion. Same constraint as the widgets — it regenerates the
# project, so it must run BEFORE the PlistBuddy patches below. The two injection
# scripts are commutative with each other (each re-reads project.yml from disk),
# so this order is only for readability. NUVO_IOS_WATCH=0 ships the plain app if
# the watch target ever blocks a build.
if [ "${NUVO_IOS_WATCH:-1}" = "1" ]; then
  ruby "${ROOT}/scripts/ios-watch.rb"
else
  echo "ios-watch: skipped (NUVO_IOS_WATCH=0)"
fi

# App Store export compliance — Nuvo uses HTTPS only (Supabase); no custom crypto.
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" "$PLIST"

# Deep links for widgets / Siri / home-screen shortcuts. tauri-plugin-deep-link
# delivers the opened URL to the webview; MobileShell's applyShortcut opens the
# matching overlay (src/lib/shortcuts.ts). nuvo://capture → the capture sheet,
# nuvo://chat → the Nuvo chat.
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string day.nuvo.app" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string nuvo" "$PLIST"

# Phone-first: portrait only (matches PWA manifest orientation).
/usr/libexec/PlistBuddy -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"

# `tauri ios init` emits Tauri's default asset catalog; overlay the Nuvo icons
# generated from src-tauri/app-icon.svg (npm run tauri:icon).
ICON_SRC="${ROOT}/src-tauri/icons/ios"
ICON_DST="${ROOT}/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"
if [ ! -d "$ICON_SRC" ]; then
  echo "ios-postinit: missing $ICON_SRC — run 'npm run tauri:icon' first"
  exit 1
fi
cp -f "${ICON_SRC}"/*.png "${ICON_DST}/"
echo "ios-postinit: copied Nuvo icons into ${ICON_DST}"

# App Store Connect rejects any iOS app icon carrying an alpha channel (90717).
# `npm run tauri:icon` renders these alpha-free (scripts/gen-ios-icons.sh),
# but guard here too so a regenerated-and-recommitted icon can't silently
# reintroduce it.
python3 - "$ICON_DST" <<'PY'
import glob
import struct
import sys

dst = sys.argv[1]
# PNG color type lives at byte 25 of the IHDR chunk; 4 = grayscale+alpha, 6 = RGBA.
bad = []
for path in sorted(glob.glob(f"{dst}/*.png")):
    with open(path, "rb") as f:
        header = f.read(26)
    color_type = header[25]
    if color_type in (4, 6):
        bad.append(path)

if bad:
    print("ios-postinit: these icons carry an alpha channel (App Store will reject them):")
    for path in bad:
        print(f"  {path}")
    print("ios-postinit: run 'npm run tauri:icon' (which strips alpha) and recommit src-tauri/icons/ios/")
    sys.exit(1)
PY

echo "ios-postinit: patched $PLIST"
