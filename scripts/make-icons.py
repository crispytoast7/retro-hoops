"""Generates the PNG app icons (pixel basketball) into public/. Run: python3 scripts/make-icons.py"""
from PIL import Image
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
