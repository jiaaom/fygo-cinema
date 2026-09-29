#!/usr/bin/env python3
"""Generate the Fygo Cinema package icon without any imaging library
(adapted from appliance-compositor's make-icons.py): a rounded-rectangle body
with a TV-and-play glyph, supersampled for anti-aliasing. FygoOS asks for a
rounded-rect body on a square canvas.

    make-icons.py <package dir> <colour hex> [--ui <ui dir>]

Writes ICON.PNG and ICON_256.PNG (both 256 px: App Center scales ICON.PNG
up, so the nominal 64 px looks blurry) and, with --ui, the desktop entry
icons images/icon_64.png and images/icon_256.png."""
import math, struct, sys, zlib


def png(width, height, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def rounded_rect(x, y, size, radius, margin):
    """1 inside the rounded square, 0 outside."""
    lo, hi = margin, size - margin
    if x < lo or x > hi or y < lo or y > hi:
        return 0
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    return 1 if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 else 0


def in_rrect(u, v, x0, y0, x1, y1, r):
    """1 inside the rounded rectangle (x0,y0)-(x1,y1), coordinates in 0..1."""
    if u < x0 or u > x1 or v < y0 or v > y1:
        return 0
    cx = min(max(u, x0 + r), x1 - r)
    cy = min(max(v, y0 + r), y1 - r)
    return 1 if (u - cx) ** 2 + (v - cy) ** 2 <= r * r else 0


def tv(x, y, size):
    """White glyph: a TV (screen outline on a small stand) with a play
    triangle on it."""
    u, v = x / size, y / size
    x0, y0, x1, y1, line = 0.20, 0.25, 0.80, 0.66, 0.035
    ink = 0
    if in_rrect(u, v, x0, y0, x1, y1, 0.05) and not in_rrect(u, v, x0 + line, y0 + line, x1 - line, y1 - line, 0.03):
        ink = 1
    # stand: a short neck and a foot
    if 0.47 <= u <= 0.53 and y1 <= v <= 0.72:
        ink = 1
    if in_rrect(u, v, 0.36, 0.72, 0.64, 0.76, 0.02):
        ink = 1
    # play triangle, pointing right, centred on the screen
    cx, cy, r = 0.515, (y0 + y1) / 2, 0.12
    if u >= cx - r * 0.75 and abs(v - cy) <= (cx + r - u) * 0.62 and u <= cx + r:
        ink = 1
    return ink


def render(size, colour, glyph, ss=4):
    rgb = tuple(int(colour[i:i + 2], 16) for i in (0, 2, 4))
    dark = tuple(max(0, int(c * 0.72)) for c in rgb)
    rows = []
    n = size * ss
    for py in range(size):
        row = []
        for px in range(size):
            body = ink = 0
            for sy in range(ss):
                for sx in range(ss):
                    x, y = px + (sx + 0.5) / ss, py + (sy + 0.5) / ss
                    b = rounded_rect(x, y, size, size * 0.22, size * 0.04)
                    body += b
                    if b:
                        ink += glyph(x, y, size)
            body /= ss * ss
            ink /= ss * ss
            t = py / size  # vertical gradient
            base = tuple(int(rgb[i] * (1 - t) + dark[i] * t) for i in range(3))
            col = tuple(int(base[i] * (1 - ink) + 255 * ink) for i in range(3))
            row += [*col, int(255 * body)]
        rows.append(row)
    return png(size, size, rows)


def main():
    args = sys.argv[1:]
    out, colour = args[0], args[1].lstrip("#")
    glyph = tv
    targets = [(f"{out}/ICON.PNG", 256), (f"{out}/ICON_256.PNG", 256)]
    if "--ui" in args:
        ui = args[args.index("--ui") + 1]
        targets += [(f"{ui}/images/icon_64.png", 64), (f"{ui}/images/icon_256.png", 256)]
    rendered = {}
    for path, size in targets:
        rendered.setdefault(size, render(size, colour, glyph))
        with open(path, "wb") as f:
            f.write(rendered[size])


if __name__ == "__main__":
    main()
