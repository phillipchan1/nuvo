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

# App Store export compliance — Nuvo uses HTTPS only (Supabase); no custom crypto.
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" "$PLIST"

# Deep links for widgets / Siri / home-screen shortcuts (phase 2 handlers in MobileShell).
# nuvo://capture → ?shortcut=capture, nuvo://chat → ?shortcut=chat
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

echo "ios-postinit: patched $PLIST"
