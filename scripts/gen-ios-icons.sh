#!/usr/bin/env bash
# Renders src-tauri/app-icon-ios.svg (the full-bleed, no-rounded-corners
# variant — see its header comment) directly to every size iOS's
# AppIcon.appiconset needs, overwriting whatever `tauri icon` put in
# src-tauri/icons/ios/. Two problems this sidesteps:
#   1. `tauri icon --ios-color` still writes RGBA PNGs (alpha ~254-255 —
#      opaque in practice, but the channel is present), and App Store Connect
#      rejects any iOS app icon that carries one, not just the 1024pt
#      marketing icon (error 90717).
#   2. Our brand mark is drawn as a rounded squircle with transparent
#      corners (for the macOS/.icns look, where the OS does no masking of
#      its own). Filling those transparent corners in for iOS just relocates
#      the problem: iOS applies its own squircle mask on top, and its curve
#      doesn't line up with ours, so the filled-in corners peek out as a
#      visible ring around the icon. Rendering iOS's icons from a plain,
#      full-bleed square (no corner radius, no transparency at all) and
#      letting iOS do 100% of the masking is what Apple's HIG asks for, and
#      is the only way to guarantee no seam regardless of which mask curve
#      iOS is using this year.
#
# Also fixes the PWA apple-touch-icon for the same reason: Safari's "Add to
# Home Screen" applies the same iOS mask, and sync-pwa-icons.sh copies its
# apple-touch-icon.png straight from AppIcon-60x60@3x.png (this script's
# output), so no separate handling is needed there.
#
# Requires cairosvg + Pillow (`pip3 install cairosvg pillow`; cairosvg needs
# the system Cairo library — `brew install cairo` on macOS). Run after
# `tauri icon` (npm run tauri:icon chains this in), before sync-pwa-icons.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG="${ROOT}/src-tauri/app-icon-ios.svg"
IOS_DIR="${ROOT}/src-tauri/icons/ios"

if [ ! -f "$SVG" ]; then
  echo "gen-ios-icons: missing $SVG"
  exit 1
fi
mkdir -p "$IOS_DIR"

python3 - "$SVG" "$IOS_DIR" <<'PY'
import sys
import cairosvg
from PIL import Image
from io import BytesIO

svg_path, ios_dir = sys.argv[1:3]

# name -> pixel size, matching the Xcode-generated AppIcon.appiconset
# (Contents.json is regenerated fresh by `tauri ios init` in CI, but always
# expects exactly these filenames/sizes for this icon set's roles).
SIZES = {
    "AppIcon-20x20@1x.png": 20,
    "AppIcon-20x20@2x.png": 40,
    "AppIcon-20x20@2x-1.png": 40,
    "AppIcon-20x20@3x.png": 60,
    "AppIcon-29x29@1x.png": 29,
    "AppIcon-29x29@2x.png": 58,
    "AppIcon-29x29@2x-1.png": 58,
    "AppIcon-29x29@3x.png": 87,
    "AppIcon-40x40@1x.png": 40,
    "AppIcon-40x40@2x.png": 80,
    "AppIcon-40x40@2x-1.png": 80,
    "AppIcon-40x40@3x.png": 120,
    "AppIcon-60x60@2x.png": 120,
    "AppIcon-60x60@3x.png": 180,
    "AppIcon-76x76@1x.png": 76,
    "AppIcon-76x76@2x.png": 152,
    "AppIcon-83.5x83.5@2x.png": 167,
    "AppIcon-512@2x.png": 1024,
}

# Rasterize once at high resolution, downsample per size for quality.
master_bytes = cairosvg.svg2png(url=svg_path, output_width=2048, output_height=2048)
master = Image.open(BytesIO(master_bytes)).convert("RGB")

for name, size in SIZES.items():
    resized = master.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(f"{ios_dir}/{name}", "PNG")

print(f"gen-ios-icons: wrote {len(SIZES)} icons to {ios_dir}")
PY
