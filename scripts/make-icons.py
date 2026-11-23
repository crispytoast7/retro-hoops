"""Generates the PNG app icons (pixel basketball) into public/ and the Android app. Run: python3 scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw
G = [
"................",
"................",
".....oooooo.....",
"...oooodoooo o..".replace(" ", "o"),
"...odoodoodoo...",
"..oodoodoodooo..",
"..ooodododoooo..",
"..dddddddddddd..",
"..oooododooooo..",
"..oodoodoodooo..",
"..oodoodoodooo..",
"...odoodoodoo...",
"...oooodooooo...",
".....oooooo.....",
"................",
"................",
]
C = {'.': (20, 18, 31), 'o': (255, 138, 60), 'd': (122, 52, 20)}
im = Image.new('RGB', (16, 16))
for y, row in enumerate(G):
    for x, ch in enumerate(row[:16]):
        im.putpixel((x, y), C[ch])
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
    im.resize((size, size), Image.NEAREST).save(f'public/{name}')

# Android: plain and round icons for old launchers, and the ball alone (transparent around it, inside the
# middle two thirds) for adaptive icons and the launch screen, which add the night-blue behind it themselves.
RES = 'android/app/src/main/res'
if os.path.isdir(RES):
    fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
    cell, off = 20, (432 - 16 * 20) // 2
    d = ImageDraw.Draw(fg)
    for y, row in enumerate(G):
        for x, ch in enumerate(row[:16]):
            if ch != '.':
                d.rectangle([off + x * cell, off + y * cell, off + (x + 1) * cell - 1, off + (y + 1) * cell - 1], fill=C[ch] + (255,))
    for dpi, k in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
        out = f'{RES}/mipmap-{dpi}'
        os.makedirs(out, exist_ok=True)
        side = round(48 * k)
        sq = im.resize((192, 192), Image.NEAREST).resize((side, side), Image.BOX)
        sq.save(f'{out}/ic_launcher.png')
        mask = Image.new('L', (side * 4, side * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, side * 4 - 1, side * 4 - 1], fill=255)
        rnd = sq.convert('RGBA')
        rnd.putalpha(mask.resize((side, side), Image.LANCZOS))
        rnd.save(f'{out}/ic_launcher_round.png')
        fside = round(108 * k)
        fg.resize((fside, fside), Image.BOX).save(f'{out}/ic_launcher_foreground.png')
