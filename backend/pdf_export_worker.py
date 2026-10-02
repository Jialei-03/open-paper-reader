"""Fixed PDF serialization worker. No network, shell commands or document scripts."""

import io
import json
import resource
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)


def numbers(values):
    return ArrayObject([FloatObject(x) for x in values])


def point(page, x, y):
    box = page.cropbox
    left, bottom, right, top = map(float, box)
    width, height = right - left, top - bottom
    rotation = page.rotation % 360
    if rotation == 90:
        return left + y * width, bottom + x * height
    if rotation == 180:
        return right - x * width, bottom + y * height
    if rotation == 270:
        return right - y * width, top - x * height
    return left + x * width, top - y * height


def annotation(kind, color, points, content=""):
    xs, ys = zip(*points, strict=True)
    return DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject(kind),
            NameObject("/Rect"): numbers([min(xs), min(ys), max(xs), max(ys)]),
            NameObject("/C"): numbers(
                [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
            ),
            NameObject("/F"): NumberObject(4),
            NameObject("/Contents"): TextStringObject(content),
            NameObject("/T"): TextStringObject("纸间"),
        }
    )


def render(raw, metadata):
    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted or len(reader.pages) > 3000:
        raise ValueError("Unsupported PDF")
    writer = PdfWriter(clone_from=reader)
    for row in metadata["highlights"]:
        page = writer.pages[row["page"] - 1]
        points = []
        for rect in row["rects"]:
            x, y, w, h = (rect[k] for k in ("x", "y", "w", "h"))
            points.extend(
                point(page, a, b)
                for a, b in [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
            )
        obj = annotation(
            "/Highlight", row["color"], points, row["comment"] or row["quote"]
        )
        obj[NameObject("/QuadPoints")] = numbers([n for p in points for n in p])
        obj[NameObject("/CA")] = FloatObject(0.35)
        writer.add_annotation(row["page"] - 1, obj)
    for row in metadata["ink"]:
        page = writer.pages[row["page"] - 1]
        points = [point(page, p[0], p[1]) for p in row["points"]]
        if len(points) == 1:
            points.append((points[0][0] + 0.01, points[0][1] + 0.01))
        obj = annotation("/Ink", row["color"], points)
        width = row["width"] / float(page.get("/UserUnit", 1))
        bounds = [float(n) for n in obj["/Rect"]]
        obj[NameObject("/Rect")] = numbers(
            [bounds[0] - width, bounds[1] - width, bounds[2] + width, bounds[3] + width]
        )
        obj[NameObject("/InkList")] = ArrayObject(
            [numbers([n for p in points for n in p])]
        )
        obj[NameObject("/BS")] = DictionaryObject(
            {
                NameObject("/W"): FloatObject(
                    row["width"] / float(page.get("/UserUnit", 1))
                ),
                NameObject("/S"): NameObject("/S"),
            }
        )
        writer.add_annotation(row["page"] - 1, obj)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def merge(raws):
    writer = PdfWriter()
    for raw in raws:
        reader = PdfReader(io.BytesIO(raw))
        if (
            reader.is_encrypted
            or not len(reader.pages)
            or len(writer.pages) + len(reader.pages) > 3000
        ):
            raise ValueError("Unsupported PDF")
        for page in reader.pages:
            # Export page content only, without executable document/page actions
            # or embedded attachments from either input.
            writer.add_page(page, excluded_keys=("/AA", "/Annots"))
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def main():
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    header = sys.stdin.buffer.read(4)
    length = int.from_bytes(header, "big")
    if length > 40 * 1024**2:
        raise ValueError("Too many annotations")
    metadata = json.loads(sys.stdin.buffer.read(length))
    if metadata.get("operation") == "merge":
        lengths = metadata["lengths"]
        if len(lengths) != 2 or any(
            type(n) is not int or not 0 < n <= 50 * 1024**2 for n in lengths
        ):
            raise ValueError("Invalid merge inputs")
        raws = [sys.stdin.buffer.read(n) for n in lengths]
        if any(
            len(raw) != n for raw, n in zip(raws, lengths, strict=True)
        ) or sys.stdin.buffer.read(1):
            raise ValueError("Invalid merge payload")
        result = merge(raws)
    else:
        raw = sys.stdin.buffer.read(50 * 1024**2 + 1)
        if len(raw) > 50 * 1024**2:
            raise ValueError("File too large")
        result = render(raw, metadata)
    if len(result) > 100 * 1024**2:
        raise ValueError("Export too large")
    sys.stdout.buffer.write(result)


if __name__ == "__main__":
    main()
