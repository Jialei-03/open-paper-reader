#!/usr/bin/env python
"""Turn the raw captures into the homepage's images.

  python scripts/showcase/export.py <captures-dir> <amem.pdf> <amem-zh.pdf> [name ...]

Reads the PNGs capture.mjs wrote (1280x800 CSS pixels at 2x), crops each to the
part of the window that shows the feature, writes lossy WebP files into
frontend/public/assets/showcase/ and records each picture's display size,
pixel density and a content hash in frontend/src/features/showcase-dimensions.json
(the hash is the cache-busting ?v= of the image URL). Nothing is drawn on or
retouched: a crop is only a crop, and the two layout-translation pages are the
real pages of the real PDFs.
"""

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/assets/showcase"
DIMENSIONS = ROOT / "frontend/src/features/showcase-dimensions.json"
SCALE = 2  # the captures are taken at device scale factor 2

# name: (capture, (x, y, width, height) in CSS pixels, webp quality)
PANEL = (732, 56, 482, 744)  # the side panel of the reader, whole
CROPS = {
    # The assistant, one idea each.
    "story-compare": ("agent-results", (386, 14, 890, 770), 88),
    "story-trace": ("agent-ops", (386, 14, 890, 560), 88),
    "organize": ("agent-organize", PANEL, 90),
    "chat": ("agent-chat", PANEL, 90),
    "notes-sources": ("agent-notes", PANEL, 90),
    "permission": ("agent-permission", (730, 430, 486, 370), 90),
    "capabilities": ("agent-capabilities", (861, 0, 419, 440), 90),
    # The workspace around it.
    "story-note": ("reader-ink", (59, 130, 612, 560), 88),
    "story-library": ("library-graph-focus", (245, 140, 660, 580), 88),
    "dark": ("dark-reader", (0, 0, 1280, 640), 82),
    # The feature explorer.
    "explain": ("reader-explain", (738, 306, 470, 494), 90),
    "region": ("reader-region", (150, 112, 710, 368), 90),
    "formula": ("reader-formula", (738, 306, 470, 494), 90),
    "table": ("reader-table", (738, 124, 470, 356), 90),
    "translate": ("reader-translate", (0, 300, 1216, 500), 88),
    "layout": ("reader-layout", (0, 56, 1216, 560), 88),
    "translate-selection": ("reader-translate-selection", (738, 340, 470, 440), 90),
    "guide": ("reader-guide", (738, 56, 470, 744), 90),
    "quiz": ("reader-quiz", (738, 56, 470, 744), 90),
    "ai-highlights": ("reader-ai-highlights", (0, 56, 1216, 744), 88),
    "figures": ("reader-figures", (738, 56, 470, 744), 90),
    "outline": ("reader-outline", (0, 56, 700, 744), 90),
    "search": ("reader-search", (0, 0, 700, 360), 90),
    "cite": ("reader-cite", (160, 340, 540, 460), 90),
    "citations": ("reader-citations", (738, 56, 470, 744), 90),
    "palette": ("reader-palette", (160, 330, 620, 380), 90),
    "comment": ("reader-comment", (370, 210, 540, 380), 90),
    "ink": ("reader-ink", (59, 90, 1157, 650), 88),
    "notes": ("reader-palette", (738, 56, 470, 744), 90),
    "import": ("library-import", (376, 20, 528, 700), 90),
    "library": ("library-list", (210, 0, 1070, 520), 88),
    "batch": ("library-batch", (210, 0, 1070, 330), 90),
    "quicksearch": ("library-search", (384, 220, 512, 360), 90),
    "graph": ("library-graph-focus", (235, 100, 1035, 640), 88),
    "share": ("reader-share", (384, 220, 512, 360), 90),
    "export": ("reader-export", (330, 0, 420, 150), 90),
    "models": ("settings-models", (384, 15, 512, 750), 90),
}
# Pages of the paper before and after layout translation: the PDF page number and
# the band of the page to show, as fractions of its height (the same for both).
COMPARE = {"formula": (4, 0.045, 0.665), "figure": (3, 0.03, 0.64)}
COMPARE_SCALE = 1.75


def save(image, name, display, quality, density, dimensions):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.webp"
    image.save(path, "WEBP", quality=quality, method=6)
    data = path.read_bytes()
    dimensions[path.name] = {
        "width": display[0],
        "height": display[1],
        "pixelRatio": density,
        "version": hashlib.sha256(data).hexdigest()[:12],
    }
    return len(data)


def main():
    captures, english, chinese, *only = sys.argv[1:]
    # A full export starts from nothing, so pictures that are no longer used leave the file.
    dimensions = json.loads(DIMENSIONS.read_text()) if only and DIMENSIONS.exists() else {}
    total = 0
    for name, (source, (x, y, w, h), quality) in CROPS.items():
        if only and name not in only:
            continue
        image = Image.open(Path(captures) / f"{source}.png").convert("RGB")
        box = (x * SCALE, y * SCALE, (x + w) * SCALE, (y + h) * SCALE)
        assert box[2] <= image.width and box[3] <= image.height, (name, box, image.size)
        size = save(image.crop(box), name, (w, h), quality, SCALE, dimensions)
        total += size
        print(f"{name:22} {w}x{h}  {size // 1024:4} KB")
    if not only or any(name.startswith("compare") for name in only):
        import pypdfium2 as pdfium

        for label, (number, top, bottom) in COMPARE.items():
            for language, pdf in (("en", english), ("zh", chinese)):
                page = pdfium.PdfDocument(pdf)[number - 1]
                image = page.render(scale=COMPARE_SCALE).to_pil().convert("RGB")
                width, height = page.get_size()
                band = image.crop((0, round(image.height * top), image.width, round(image.height * bottom)))
                size = save(
                    band,
                    f"compare-{language}-{label}",
                    (round(width), round(height * (bottom - top))),
                    88,
                    COMPARE_SCALE,
                    dimensions,
                )
                total += size
                print(f"compare-{language}-{label:8} {band.width}x{band.height}px  {size // 1024:4} KB")
    DIMENSIONS.write_text(json.dumps(dimensions, indent=2, ensure_ascii=False) + "\n")
    print("total", total // 1024, "KB")


if __name__ == "__main__":
    main()
