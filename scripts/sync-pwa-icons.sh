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

# Maskable: 80% safe zone on Warm Paper (#fdf6ec), same ground as iOS icons.
python3 - "$ICON" "$MASKABLE" <<'PY'
import sys
from PIL import Image

src_path, out_path = sys.argv[1:3]
size = 512
safe = int(size * 0.8)
ground = (253, 246, 236, 255)

src = Image.open(src_path).convert("RGBA")
src.thumbnail((safe, safe), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (size, size), ground)
ox = (size - src.width) // 2
oy = (size - src.height) // 2
canvas.paste(src, (ox, oy), src)
canvas.save(out_path, "PNG")
PY

if [ -d "${ROOT}/marketing/public" ]; then
  cp -f "${PUB}/favicon.png" "${ROOT}/marketing/public/favicon.png"
fi

echo "sync-pwa-icons: updated public/ (and marketing/public/favicon.png)"
