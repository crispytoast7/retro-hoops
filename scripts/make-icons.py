"""Draws the app icon (a pixel basketball) and writes it everywhere it is used: the website (public/),
the iPhone app and the Android app. Run: python3 scripts/make-icons.py"""
import math
import os
from PIL import Image, ImageDraw

N = 32                      # the ball is drawn on a 32 x 32 grid of fat pixels
C = (N - 1) / 2             # centre of the grid
R = 12.6                    # ball radius in grid pixels: just inside the round "safe zone" phones crop icons to
BG = (20, 18, 31)
LIGHT, BASE, SHADE, DEEP = (255, 178, 104), (255, 138, 60), (224, 104, 36), (176, 72, 22)
SEAM = (74, 30, 12)


def cell(x, y):
    """Colour of one grid pixel, or None outside the ball."""
    dx, dy = x - C, y - C
    d = math.hypot(dx, dy)
    if d > R:
        return None
    # seams: one down the middle, one across, and a curved one on each side
    side = min(abs(math.hypot(dx - s * 20.5, dy) - 13.6) for s in (-1, 1))
    if abs(dx) < 1 or abs(dy) < 1 or side < 0.95:
        return SEAM
    # lit from the upper left: a bright patch, a darker rim away from the light
    light = (-dx * 0.62 - dy * 0.78) / R + (1 - (d / R) ** 2) * 0.35
    if math.hypot(dx + 4.6, dy + 5.2) < 3.3:
        return LIGHT
    if d > R - 1.3 and light < 0.1:
        return DEEP
    if light < -0.42:
        return SHADE
    return BASE


GRID = [[cell(x, y) for x in range(N)] for y in range(N)]


def render(size, background=BG, span=1.0):
    """The icon at `size` pixels. `span` is how much of the picture the 32-pixel grid covers."""
    big = N * 40
    art = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    for y, row in enumerate(GRID):
        for x, col in enumerate(row):
            if col:
                d.rectangle([x * 40, y * 40, x * 40 + 39, y * 40 + 39], fill=col + (255,))
    inner = round(size * span)
    art = art.resize((inner, inner), Image.NEAREST if inner % N == 0 else Image.BOX)
    out = Image.new('RGBA', (size, size), (background + (255,)) if background else (0, 0, 0, 0))
    off = (size - inner) // 2
    out.alpha_composite(art, (off, off))
    return out


# website
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
    render(size).convert('RGB').save(f'public/{name}')
rects = [f'<rect width="{N}" height="{N}" fill="#{BG[0]:02x}{BG[1]:02x}{BG[2]:02x}"/>']
for y, row in enumerate(GRID):
    x = 0
    while x < N:
        col = row[x]
        if not col:
            x += 1
            continue
        w = 1
        while x + w < N and row[x + w] == col:
            w += 1
        rects.append(f'<rect x="{x}" y="{y}" width="{w}" height="1" fill="#{col[0]:02x}{col[1]:02x}{col[2]:02x}"/>')
        x += w
with open('public/icon.svg', 'w') as f:
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}" shape-rendering="crispEdges">\n' + '\n'.join(rects) + '\n</svg>\n')

# iPhone app
IOS = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
if os.path.isfile(IOS):
    render(1024).convert('RGB').save(IOS)

# Android app: plain and round icons for old launchers, and the ball alone (transparent around it, inside the
# middle two thirds) for adaptive icons and the launch screen, which add the night-blue behind it themselves.
RES = 'android/app/src/main/res'
if os.path.isdir(RES):
    for dpi, k in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
        out = f'{RES}/mipmap-{dpi}'
        os.makedirs(out, exist_ok=True)
        side = round(48 * k)
        sq = render(side)
        sq.convert('RGB').save(f'{out}/ic_launcher.png')
        mask = Image.new('L', (side * 4, side * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, side * 4 - 1, side * 4 - 1], fill=255)
        rnd = sq.copy()
        rnd.putalpha(mask.resize((side, side), Image.LANCZOS))
        rnd.save(f'{out}/ic_launcher_round.png')
        render(round(108 * k), background=None, span=320 / 432).save(f'{out}/ic_launcher_foreground.png')
