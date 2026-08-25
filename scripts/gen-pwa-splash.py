#!/usr/bin/env python3
"""Solid-paper iOS startup images — no brand mark.

iOS shows apple-touch-startup-image on every standalone PWA launch. A logo
there is a splash the operator did not ask for (D-117). These files exist so
the installed PWA does not flash white; they must match the first HTML paint
in index.html (light #f4f1ea / dark #141320).
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "splash"

# (css-pixel width, css-pixel height, pixel-ratio) → filename stem
# Must stay in lockstep with the <link rel="apple-touch-startup-image"> tags
# in index.html.
SIZES = [
    (375, 667, 2),   # 750x1334
    (375, 812, 3),   # 1125x2436
    (414, 896, 2),   # 828x1792
    (414, 896, 3),   # 1242x2688
    (390, 844, 3),   # 1170x2532
    (393, 852, 3),   # 1179x2556
    (402, 874, 3),   # 1206x2622
    (428, 926, 3),   # 1284x2778
    (430, 932, 3),   # 1290x2796
    (440, 956, 3),   # 1320x2868
]

LIGHT = (0xF4, 0xF1, 0xEA)
DARK = (0x14, 0x13, 0x20)


def write_png(path: Path, width: int, height: int, rgb: tuple[int, int, int]) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + (bytes(rgb) * width) for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for css_w, css_h, dpr in SIZES:
        w, h = css_w * dpr, css_h * dpr
        stem = f"splash-{w}x{h}"
        write_png(OUT / f"{stem}.png", w, h, LIGHT)
        write_png(OUT / f"{stem}-dark.png", w, h, DARK)
        print(f"  {stem} ({w}x{h})")
    print(f"wrote {len(SIZES) * 2} paper splash images to {OUT}")


if __name__ == "__main__":
    main()
