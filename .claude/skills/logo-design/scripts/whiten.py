"""whiten.py <in.png> <out.jpg>

Shifts a flat off-white background to pure white while leaving the logo colours alone:
the background colour is the median of the border, and each pixel moves toward white in
proportion to how close it is to that colour. Transparent PNGs are flattened onto white
first. Use when white-background logos come back cream or grey instead of regenerating.
"""
import sys

import numpy as np
from PIL import Image

src = Image.open(sys.argv[1])
if src.mode in ("RGBA", "LA", "P"):
    src = src.convert("RGBA")
    base = Image.new("RGBA", src.size, (255, 255, 255, 255))
    base.alpha_composite(src)
    src = base
im = np.asarray(src.convert("RGB")).astype(np.float32)
b = 12
border = np.concatenate([im[:b].reshape(-1, 3), im[-b:].reshape(-1, 3),
                         im[:, :b].reshape(-1, 3), im[:, -b:].reshape(-1, 3)])
bg = np.median(border, axis=0)
d = np.sqrt(((im - bg) ** 2).sum(-1))
t = np.clip(1 - (d - 8) / 40, 0, 1)[..., None]
out = Image.fromarray(np.clip(im + t * (255 - bg), 0, 255).astype(np.uint8))
out.thumbnail((1100, 1100))
out.save(sys.argv[2], quality=90)
print(sys.argv[1], "background was", bg.astype(int).tolist())
