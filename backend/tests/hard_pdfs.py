"""PDFs that are hard to import, generated when a test runs.

Each builder returns the bytes of one kind of file researchers actually bring:
publisher PDFs with only an owner password, scans without a text layer, a
download that stopped part way, a web page saved as ``.pdf``. No binary sample
is committed; every file is made here from pypdf and Pillow.
"""

import io

from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions as Allow
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

WIDTH, HEIGHT = 612, 792
# What a publisher typically allows without the owner password: printing and
# copying text, not editing. The reserved bits are set, as Acrobat writes them.
PUBLISHER_PERMISSIONS = 0xFFFFF0C0 | int(
    Allow.PRINT
    | Allow.EXTRACT
    | Allow.EXTRACT_TEXT_AND_GRAPHICS
    | Allow.PRINT_TO_REPRESENTATION
)


def _text_page(writer, number):
    """One page whose text layer is the line ``Evidence on page N``.

    Written like ``test_agents.pdf_bytes``, except that the content is an
    indirect stream, as the format requires: PDFium, which the preparation
    worker reads text with, ignores a page whose content is inline.
    """
    page = writer.add_blank_page(WIDTH, HEIGHT)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    content = DecodedStreamObject()
    content.set_data(
        f"BT /F1 12 Tf 40 700 Td (Evidence on page {number}) Tj ET".encode()
    )
    page[NameObject("/Contents")] = writer._add_object(content)


def _bytes(writer):
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _text_writer(pages):
    writer = PdfWriter()
    for number in range(1, pages + 1):
        _text_page(writer, number)
    return writer


def text_pdf(pages: int = 3) -> bytes:
    return _bytes(_text_writer(pages))


def image_only_pdf(pages: int = 2) -> bytes:
    """A scan: every page is a picture of words, with no text layer."""
    images = []
    for number in range(1, pages + 1):
        image = Image.new("L", (WIDTH, HEIGHT), 255)
        ImageDraw.Draw(image).text(
            (40, 80), f"Scanned page {number}", fill=0, font_size=24
        )
        images.append(image)
    out = io.BytesIO()
    images[0].save(out, "PDF", resolution=72.0, save_all=True, append_images=images[1:])
    return out.getvalue()


def mixed_pdf(text_pages: int = 3, image_page: int = 2) -> bytes:
    """``text_pages`` text pages and one scanned page at ``image_page``.

    The PDF has ``text_pages + 1`` pages in all.

    Text pages keep their real page number in their text, so a page that is
    skipped cannot shift the numbers of the pages after it unnoticed.
    """
    scan = PdfReader(io.BytesIO(image_only_pdf(1))).pages[0]
    writer = PdfWriter()
    for number in range(1, text_pages + 2):
        if number == image_page:
            writer.add_page(scan)
        else:
            _text_page(writer, number)
    return _bytes(writer)


def owner_locked_pdf(algorithm: str = "AES-128") -> bytes:
    """Only an owner password; the user password is empty, so it opens directly."""
    writer = _text_writer(3)
    writer.encrypt(
        user_password="",
        owner_password="publisher-owner",
        algorithm=algorithm,
        permissions_flag=PUBLISHER_PERMISSIONS,
    )
    return _bytes(writer)


def password_pdf() -> bytes:
    """Opening it needs a user password."""
    writer = _text_writer(3)
    writer.encrypt(
        user_password="reader-secret",
        owner_password="publisher-owner",
        algorithm="AES-128",
    )
    return _bytes(writer)


def truncated_pdf() -> bytes:
    """A download that stopped: the last 40% of a normal PDF is missing."""
    raw = text_pdf()
    return raw[: len(raw) * 6 // 10]


def junk_prefixed_pdf() -> bytes:
    """A few stray bytes before ``%PDF-``; the format allows them in the first 1024."""
    return b"\xef\xbb\xbf\r\njunk\r\n" + text_pdf()


def not_a_pdf() -> bytes:
    """What a download often is instead: a web page."""
    return (
        b"<!doctype html>\n<html><head><title>Paper</title></head>"
        b"<body><p>Please sign in to download this paper.</p></body></html>\n"
    )


def many_pages_pdf(pages: int = 3001) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(WIDTH, HEIGHT)
    return _bytes(writer)
