# Draws the app icon (four stone slabs). Replace app/assets/icon.png with the company logo later.
import os
from PIL import Image, ImageDraw
S = 1024
im = Image.new("RGB", (S, S), "#0E6B5C"); d = ImageDraw.Draw(im)
pad, g = 210, 26; w = (S - 2 * pad - g) // 2
for i in range(2):
    for j in range(2):
        x, y = pad + i * (w + g), pad + j * (w + g)
        d.rounded_rectangle([x, y, x + w, y + w], radius=28, fill="#F3F4F1" if (i + j) % 2 == 0 else "#CFE5DE")
d.line([(pad + 40, pad + w - 60), (pad + w - 50, pad + 50)], fill="#9FC9BC", width=10)
os.makedirs(os.path.join(os.path.dirname(__file__), "..", "assets"), exist_ok=True)
out = os.path.join(os.path.dirname(__file__), "..", "assets", "icon.png")
if not os.path.exists(out): im.save(out)
