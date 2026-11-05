"""예제 클레임 사진(합성 이미지)을 만든다: 반시 16개 중 2개가 터진 상자."""

import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

DAMAGED = {(1, 2), (3, 0)}


def draw(path: Path) -> None:
    random.seed(7)
    img = Image.new("RGB", (720, 720), (196, 160, 112))
    d = ImageDraw.Draw(img)
    d.rectangle([30, 30, 690, 690], outline=(120, 90, 55), width=14)
    for row in range(4):
        for col in range(4):
            cx, cy = 115 + col * 163, 115 + row * 163
            if (row, col) in DAMAGED:
                d.ellipse([cx - 95, cy - 70, cx + 100, cy + 85], fill=(150, 60, 20))
                points = []
                for k in range(14):
                    angle = 2 * math.pi * k / 14
                    radius = random.randint(40, 72)
                    points.append((cx + radius * math.cos(angle), cy + radius * 0.8 * math.sin(angle)))
                d.polygon(points, fill=(205, 85, 25))
                d.line([cx - 45, cy - 10, cx + 40, cy + 15], fill=(110, 30, 10), width=8)
                d.line([cx - 10, cy - 40, cx + 5, cy + 35], fill=(110, 30, 10), width=6)
            else:
                d.ellipse([cx - 66, cy - 62, cx + 66, cy + 62], fill=(232, 112, 28))
                d.ellipse([cx - 40, cy - 40, cx - 10, cy - 15], fill=(246, 160, 80))
                d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=(70, 95, 40))
    img.filter(ImageFilter.SMOOTH).save(path)


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("claim_photo.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    draw(out)
    print(out)
