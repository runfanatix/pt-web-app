"""vectorize.py <picked.jpg> <outdir> --brand "#F2C230" [--ink "#141414"] [--name ondra]

Turns the logo Brendan picked into clean SVG masters, so it can be reused anywhere at any size.
The background colour is the median of the image border; every pixel far enough from it is logo.
The mask is traced at 2x with vtracer (smooth splines), then split at the widest empty band into
the mark (top) and the wordmark (bottom). Writes, for each of logo / mark / wordmark:
  <name>-<part>-black.svg, -white.svg, -brand.svg   (fill only, no background, tight viewBox)
plus <name>-<part>-mask.png (what was traced) and preview.html (every file on dark and light).
Needs Pillow, numpy and vtracer (pip install vtracer).
"""
import argparse
import re
from pathlib import Path

import numpy as np
import vtracer
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("outdir")
ap.add_argument("--brand", required=True, help="brand colour for the -brand variant")
ap.add_argument("--ink", default="#141414", help="colour for the -black variant")
ap.add_argument("--name", default="logo")
a = ap.parse_args()
out = Path(a.outdir)
out.mkdir(parents=True, exist_ok=True)

# 1. Logo mask: distance from the border colour, at 2x for smoother traced edges.
im = Image.open(a.src).convert("RGB")
im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
px = np.asarray(im).astype(np.float32)
b = 24
border = np.concatenate([px[:b].reshape(-1, 3), px[-b:].reshape(-1, 3),
                         px[:, :b].reshape(-1, 3), px[:, -b:].reshape(-1, 3)])
bg = np.median(border, axis=0)
dist = np.sqrt(((px - bg) ** 2).sum(-1))
mask = dist > 0.5 * dist.max()

# 2. Split mark from wordmark at the widest empty band between the logo's top and bottom rows.
rows = np.where(mask.any(1))[0]
top, bottom = rows.min(), rows.max()
empty = ~mask[top:bottom + 1].any(1)
best, run, start = (0, 0), 0, 0
for i, e in enumerate(empty):
    if e:
        run, start = (run + 1, start if run else i)
        if run > best[0]:
            best = (run, start)
    else:
        run = 0
cut = top + best[1] + best[0] // 2 if best[0] else None
parts = {"logo": mask}
if cut:
    m, w = mask.copy(), mask.copy()
    m[cut:] = False
    w[:cut] = False
    parts["mark"], parts["wordmark"] = m, w


def trace(part_mask, part):
    ys, xs = np.where(part_mask)
    pad = 8
    y0, y1 = max(ys.min() - pad, 0), ys.max() + pad
    x0, x1 = max(xs.min() - pad, 0), xs.max() + pad
    crop = part_mask[y0:y1 + 1, x0:x1 + 1]
    png = out / f"{a.name}-{part}-mask.png"
    Image.fromarray(np.where(crop, 0, 255).astype(np.uint8)).save(png)
    raw = vtracer.convert_raw_image_to_svg(
        open(png, "rb").read(), img_format="png", colormode="binary", mode="spline",
        filter_speckle=8, corner_threshold=60, length_threshold=4.0, max_iterations=10,
        splice_threshold=45, path_precision=2)
    paths = re.findall(r"<path[^>]*/>", raw)
    w, h = crop.shape[1], crop.shape[0]
    for variant, colour in (("black", a.ink), ("white", "#FFFFFF"), ("brand", a.brand)):
        body = "\n".join(re.sub(r'fill="[^"]*"', f'fill="{colour}"', p) for p in paths)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
               f'role="img" aria-label="{a.name}">\n{body}\n</svg>\n')
        (out / f"{a.name}-{part}-{variant}.svg").write_text(svg, encoding="utf-8")
    return w, h


sizes = {part: trace(m, part) for part, m in parts.items()}

# 3. Preview page: every file on dark, light and brand grounds.
cells = ""
for part in parts:
    for variant, ground in (("black", "#FFFFFF"), ("white", "#141414"), ("brand", "#141414"),
                            ("black", a.brand)):
        cells += (f'<div style="background:{ground};padding:40px;display:flex;align-items:center;'
                  f'justify-content:center;height:260px"><img src="{a.name}-{part}-{variant}.svg" '
                  f'style="max-width:100%;max-height:100%"></div>')
(out / "preview.html").write_text(
    f'<body style="margin:0;font-family:sans-serif"><div style="display:grid;'
    f'grid-template-columns:repeat(4,1fr);gap:8px;padding:8px;background:#888">{cells}</div></body>',
    encoding="utf-8")
print("background", bg.astype(int).tolist(), "split at", cut, "sizes", sizes)
print("wrote", sorted(p.name for p in out.glob("*.svg")))
