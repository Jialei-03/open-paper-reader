"""Parse model HTML with Docling in an isolated, network-free subprocess."""

import json
import math
import resource
import sys


def parse(request):
    from docling.utils.chandra_utils import parse_chandra_html
    from docling_core.types.doc import Size

    doc = parse_chandra_html(request["html"], Size(width=1000, height=1000), 1)
    data = doc.export_to_dict()
    blocks = []
    for item in (
        data.get("pictures", []) + data.get("tables", []) + data.get("texts", [])
    ):
        label = item.get("label")
        if label not in ("picture", "table", "formula"):
            continue
        for prov in item.get("prov", [])[:1]:
            box = prov["bbox"]
            left, right = sorted((box["l"], box["r"]))
            top, bottom = sorted((box["t"], box["b"]))
            if box.get("coord_origin") == "BOTTOMLEFT":
                top, bottom = 1000 - bottom, 1000 - top
            rect = [
                left / 1000,
                top / 1000,
                (right - left) / 1000,
                (bottom - top) / 1000,
            ]
            if (
                not all(math.isfinite(n) for n in rect)
                or min(rect) < 0
                or rect[2] <= 0.002
                or rect[3] <= 0.002
                or rect[0] + rect[2] > 1.00001
                or rect[1] + rect[3] > 1.00001
            ):
                continue
            blocks.append({"kind": label, "rect": rect})
    return {"blocks": blocks[:40], "engine": "Docling + vision"}


if __name__ == "__main__":
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (1400 * 1024**2, 1400 * 1024**2))
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    raw = sys.stdin.buffer.read(2 * 1024**2 + 1)
    if len(raw) > 2 * 1024**2:
        raise ValueError("Parser input too large")
    print(json.dumps(parse(json.loads(raw))))
