import io
import uuid

import pytest
from pypdf import PdfReader, PdfWriter

from backend.pdf_export_worker import point
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes


def test_portable_pdf_keeps_text_highlights_comments_and_ink_private(env):
    _, a, b, _ = env
    p = paper(a)
    f = attach(a, p, "source.pdf", pdf_bytes())
    endpoint = "/api/v1/files/" + f["id"]
    annotation = {
        "page": 1,
        "quote": "Source evidence",
        "color": "#FACC15",
        "comment": "Private comment",
        "rects": [{"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.05}],
    }
    assert (
        a.put(
            endpoint + "/annotations/" + str(uuid.uuid4()), json=annotation
        ).status_code
        == 200
    )
    assert (
        a.put(
            endpoint + "/ink/" + str(uuid.uuid4()),
            json={
                "page": 1,
                "color": "#123456",
                "width": 2,
                "points": [[0.1, 0.1, 0.5], [0.2, 0.3, 0.5]],
            },
        ).status_code
        == 200
    )
    assert b.get(endpoint + "/annotated-pdf").status_code == 404
    exported = a.get(endpoint + "/annotated-pdf")
    assert exported.status_code == 200, (
        exported.text[:100] if exported.status_code != 200 else ""
    )
    reader = PdfReader(io.BytesIO(exported.content))
    original = PdfReader(io.BytesIO(pdf_bytes()))
    assert len(reader.pages) == len(original.pages)
    assert reader.pages[0].extract_text() == original.pages[0].extract_text()
    annotations = [x.get_object() for x in reader.pages[0]["/Annots"]]
    highlight = next(x for x in annotations if x["/Subtype"] == "/Highlight")
    assert highlight["/Contents"] == "Private comment"
    assert len(highlight["/QuadPoints"]) == 8
    assert any(x["/Subtype"] == "/Ink" for x in annotations)
    assert len(a.get(endpoint + "/annotations").json()) == 1
    assert a.get(endpoint + "/content").content == pdf_bytes()


@pytest.mark.parametrize(
    "rotation,expected",
    [(0, (30, 160)), (90, (44, 45)), (180, (90, 80)), (270, (76, 195))],
)
def test_normalized_annotations_follow_crop_and_rotation(rotation, expected):
    writer = PdfWriter()
    page = writer.add_blank_page(120, 240)
    page.cropbox.lower_left = (20, 20)
    page.cropbox.upper_right = (100, 220)
    page.rotate(rotation)
    # quarter-width / 30%-height of the visible crop, independent of rendering scale.
    actual = point(page, 0.125, 0.3)
    expected_by_rotation = {0: (30, 160), 90: (44, 45), 180: (90, 80), 270: (76, 195)}
    assert actual == expected_by_rotation[rotation]


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_exported_annotations_render_in_normalized_viewport(rotation):
    """Check visible output, not just presence of annotation dictionaries."""
    import pypdfium2 as pdfium

    from backend.pdf_export_worker import render

    writer = PdfWriter()
    page = writer.add_blank_page(200, 300)
    page.cropbox.lower_left = (20, 20)
    page.cropbox.upper_right = (180, 280)
    page.rotate(rotation)
    source = io.BytesIO()
    writer.write(source)
    exported = render(
        source.getvalue(),
        {
            "highlights": [
                {
                    "page": 1,
                    "color": "#FACC15",
                    "comment": "Visible highlight",
                    "quote": "",
                    "rects": [{"x": 0.2, "y": 0.3, "w": 0.3, "h": 0.1}],
                }
            ],
            "ink": [
                {
                    "page": 1,
                    "color": "#2456A6",
                    "width": 4,
                    "points": [[0.2, 0.6, 0.5], [0.6, 0.6, 0.5]],
                }
            ],
        },
    )
    with pdfium.PdfDocument(exported) as document:
        rendered = document[0].render(scale=2, draw_annots=True).to_pil().convert("RGB")
        width, height = rendered.size
        highlight = rendered.getpixel((round(width * 0.35), round(height * 0.35)))
        ink = rendered.getpixel((round(width * 0.4), round(height * 0.6)))
        untouched = rendered.getpixel((round(width * 0.8), round(height * 0.8)))
        assert highlight[0] > 240 and highlight[1] > 220 and highlight[2] < 200
        assert ink[2] > ink[1] > ink[0] and ink[0] < 60
        assert untouched == (255, 255, 255)
