"""Generate app icons (run: python3 tools/make_icons.py). Requires Pillow."""
from PIL import Image, ImageDraw, ImageFont
import os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def make(size):
    S = 1024
    img = Image.new('RGB', (S, S))
    px = img.load()
    c1, c2 = (16, 185, 129), (37, 99, 235)  # emerald -> blue
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    d = ImageDraw.Draw(img)
    r = 300
    cx, cy = S // 2, S // 2
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255))
    d.ellipse((cx - r + 36, cy - r + 36, cx + r - 36, cy + r - 36), outline=(209, 250, 229), width=14)
    font = ImageFont.truetype(FONT, 300)
    text = 'kr'
    bbox = d.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((cx - w / 2 - bbox[0], cy - h / 2 - bbox[1] - 10), text, font=font, fill=(5, 120, 110))
    return img.resize((size, size), Image.LANCZOS)

for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    make(size).save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)
