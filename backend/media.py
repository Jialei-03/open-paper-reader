"""Fixed, resource-limited PDF/image inspector. It never executes document content.

The parent names the kind to inspect (``pdf`` or ``image``) as the only argument.
When a PDF is refused, the last line of stderr is the reason: ``encrypted``,
``unreadable`` or ``too_many_pages``. Every other failure prints the generic
message.
"""

import io
import json
import resource
import sys
import warnings

GENERIC = "Invalid, encrypted, oversized, or unsupported media"
MAX_PAGES = 3000


class Refused(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def pdf(raw):
    import pypdfium2 as pdfium

    # PDFium opens a PDF with only an owner password (the user password is
    # empty), as every viewer does, and finds a header after leading junk.
    try:
        document = pdfium.PdfDocument(raw)
    except pdfium.PdfiumError as error:
        reason = "encrypted" if "password" in str(error).lower() else "unreadable"
        raise Refused(reason) from None
    try:
        pages = len(document)
    finally:
        document.close()
    if pages < 1:
        raise Refused("unreadable")
    if pages > MAX_PAGES:
        raise Refused("too_many_pages")
    return ["application/pdf", pages]


def image(raw):
    from PIL import Image

    warnings.simplefilter("error", Image.DecompressionBombWarning)
    Image.MAX_IMAGE_PIXELS = 40_000_000
    with Image.open(io.BytesIO(raw)) as im:
        im.verify()
        mime = Image.MIME.get(im.format, "")
        if mime not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
            raise ValueError("Unsupported image")
    return [mime, None]


def main():
    kind = sys.argv[1] if len(sys.argv) == 2 else ""
    if kind not in {"pdf", "image"}:
        raise ValueError("Usage: media.py pdf|image")
    # Darwin exposes RLIMIT_AS but rejects a finite address-space limit.
    # Linux production retains it; macOS still has CPU, input-size, decoded
    # image/page limits and the parent process's 15-second timeout.
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    raw = sys.stdin.buffer.read(50 * 1024 * 1024 + 1)
    if len(raw) > 50 * 1024 * 1024:
        raise ValueError("Media inspection is limited to 50 MiB")
    print(json.dumps(pdf(raw) if kind == "pdf" else image(raw)))


if __name__ == "__main__":
    try:
        main()
    except Refused as error:
        print(error.reason, file=sys.stderr)
        sys.exit(1)
    except Exception:  # noqa: BLE001 -- never print document content or native detail
        print(GENERIC, file=sys.stderr)
        sys.exit(1)
