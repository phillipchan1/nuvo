#!/usr/bin/env bash
# `tauri icon --ios-color` fills transparent pixels but still writes RGBA PNGs
# (alpha ~254-255, i.e. opaque in practice but the channel is still present).
# App Store Connect rejects any iOS app icon — not just the 1024pt one — that
# carries an alpha channel at all (error 90717), so flatten it away here after
# every `tauri icon` run. Run after `npm run tauri:icon`'s `tauri icon` step,
# before `sync-pwa-icons.sh` (which reads these same files for the PWA icons).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="${ROOT}/src-tauri/icons/ios"

if [ ! -d "$IOS_DIR" ]; then
  echo "strip-ios-icon-alpha: run 'tauri icon' first"
  exit 1
fi

python3 - "$IOS_DIR" <<'PY'
import glob
import sys
from PIL import Image

# Same Warm Paper ground used for --ios-color and the PWA maskable icon.
GROUND = (0xFD, 0xF6, 0xEC, 255)

ios_dir = sys.argv[1]
for path in sorted(glob.glob(f"{ios_dir}/*.png")):
    im = Image.open(path).convert("RGBA")
    flattened = Image.new("RGBA", im.size, GROUND)
    flattened.paste(im, (0, 0), im)
    flattened.convert("RGB").save(path, "PNG")
PY

echo "strip-ios-icon-alpha: flattened alpha out of ${IOS_DIR}/*.png"
