#!/usr/bin/env bash
# Regenerates public/splash/* — the iOS PWA launch screens index.html links
# with apple-touch-startup-image. Each is the app's ground (--ground: light
# #f1f1f4, dark #08080a) with the rounded app icon centred at 30% of the
# screen's width. Requires Pillow (`pip3 install pillow`). Run after
# `npm run tauri:icon` (it reads src-tauri/icons/icon.png).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON="${ROOT}/src-tauri/icons/icon.png"
OUT="${ROOT}/public/splash"

python3 - "$ICON" "$OUT" <<'PY'
import os, re, sys
from PIL import Image

icon_path, out_dir = sys.argv[1:3]
icon = Image.open(icon_path).convert("RGBA")
grounds = {"": (241, 241, 244), "-dark": (8, 8, 10)}
names = [n for n in os.listdir(out_dir) if n.endswith(".png")]
sizes = sorted({tuple(map(int, re.match(r"splash-(\d+)x(\d+)", n).groups())) for n in names})
for (w, h) in sizes:
    side = round(w * 0.30)
    mark = icon.resize((side, side), Image.Resampling.LANCZOS)
    for suffix, rgb in grounds.items():
        canvas = Image.new("RGB", (w, h), rgb)
        canvas.paste(mark, ((w - side) // 2, (h - side) // 2), mark)
        canvas.save(os.path.join(out_dir, f"splash-{w}x{h}{suffix}.png"), "PNG", optimize=True)
print(f"gen-splash: wrote {len(sizes) * 2} launch screens")
PY
