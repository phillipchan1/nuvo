#!/usr/bin/env bash
# Copy Nuvo icons from src-tauri/icons/ into web-facing public/ trees.
# Run after `npm run tauri:icon` (also invoked automatically by that script).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON="${ROOT}/src-tauri/icons/icon.png"
IOS180="${ROOT}/src-tauri/icons/ios/AppIcon-60x60@3x.png"
PUB="${ROOT}/public"
MASKABLE="${PUB}/pwa-maskable-512x512.png"

if [ ! -f "$ICON" ] || [ ! -f "$IOS180" ]; then
  echo "sync-pwa-icons: run 'npm run tauri:icon' first"
  exit 1
fi

cp -f "$IOS180" "${PUB}/apple-touch-icon.png"
sips -z 256 256 "$ICON" --out "${PUB}/favicon.png" >/dev/null
sips -z 192 192 "$ICON" --out "${PUB}/pwa-192x192.png" >/dev/null
cp -f "$ICON" "${PUB}/pwa-512x512.png"

# Maskable: the full-bleed iOS master already keeps the mark inside the 80%
# safe circle (app-icon-ios.svg), so it IS the maskable icon — the platform
# crops the field, never the N.
IOS1024="${ROOT}/src-tauri/icons/ios/AppIcon-512@2x.png"
sips -z 512 512 "$IOS1024" --out "$MASKABLE" >/dev/null

if [ -d "${ROOT}/marketing/public" ]; then
  cp -f "${PUB}/favicon.png" "${ROOT}/marketing/public/favicon.png"
fi

echo "sync-pwa-icons: updated public/ (and marketing/public/favicon.png)"
