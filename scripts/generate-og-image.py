#!/usr/bin/env python3
"""Generate the default Open Graph image (1200x630) for barcelonacompare.com."""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "og-default.png")

# Warm cream -> soft peach gradient background
img = Image.new("RGB", (W, H))
top = (254, 247, 238)    # brand-50 cream
bottom = (249, 215, 165) # brand-200 peach
for y in range(H):
    t = y / H
    r = int(top[0] + (bottom[0] - top[0]) * t)
    g = int(top[1] + (bottom[1] - top[1]) * t)
    b = int(top[2] + (bottom[2] - top[2]) * t)
    ImageDraw.Draw(img).line([(0, y), (W, y)], fill=(r, g, b))

draw = ImageDraw.Draw(img)

# Category accent bars (nails pink left, massage violet right) as a subtle frame motif
draw.rectangle([0, 0, 14, H], fill=(219, 39, 119))   # accent-nails pink
draw.rectangle([W - 14, 0, W, H], fill=(124, 58, 237))  # accent-massage violet

def load_font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/NewYork.ttf" if not bold else "/System/Library/Fonts/NewYorkBold.ttf",
        "/System/Library/Fonts/Supplemental/Georgia Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

font_serif_big = load_font(88, bold=True)
font_serif_med = load_font(40, bold=True)
font_body = load_font(34)

# Wordmark
draw.text((80, 90), "Barcelona ", font=font_serif_big, fill=(41, 37, 36))
w1 = draw.textlength("Barcelona ", font=font_serif_big)
draw.text((80 + w1, 90), "Compare", font=font_serif_big, fill=(236, 122, 16))  # brand-500

# Headline
draw.text((80, 250), "Find the best of Barcelona.", font=font_serif_med, fill=(41, 37, 36))
draw.text((80, 310), "Compara. Elige. Disfruta.", font=font_serif_med, fill=(120, 113, 108))

# Stat chips
stats = [
    ("1.180 negocios", (255, 255, 255)),
    ("170.000+ reseñas", (255, 247, 238)),
    ("10 barrios", (255, 255, 255)),
]
x = 80
for label, bg in stats:
    tw = draw.textlength(label, font=font_body)
    chip_w, chip_h = int(tw) + 56, 64
    draw.rounded_rectangle([x, 470, x + chip_w, 470 + chip_h], radius=32, fill=bg, outline=(231, 229, 228), width=2)
    draw.text((x + 28, 480), label, font=font_body, fill=(41, 37, 36))
    x += chip_w + 24

# URL footer
draw.text((80, 560), "barcelonacompare.com", font=font_body, fill=(183, 72, 8))

img.save(OUT, "PNG", optimize=True)
print(f"saved {os.path.abspath(OUT)} ({os.path.getsize(os.path.abspath(OUT))//1024} KB)")
