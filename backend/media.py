"""Fixed, resource-limited PDF/image inspector. It never executes document content."""

import io
import json
import resource
import sys
import warnings


def main():
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
    if raw.startswith(b"%PDF-"):
        from pypdf import PdfReader

        pdf = PdfReader(io.BytesIO(raw), strict=False)
        if pdf.is_encrypted:
            raise ValueError("Encrypted PDFs unsupported")
        pages = len(pdf.pages)
        if not 1 <= pages <= 3000:
            raise ValueError("PDF must contain 1–3000 pages")
        result = ["application/pdf", pages]
    else:
        from PIL import Image

        warnings.simplefilter("error", Image.DecompressionBombWarning)
        Image.MAX_IMAGE_PIXELS = 40_000_000
        with Image.open(io.BytesIO(raw)) as im:
            im.verify()
            mime = Image.MIME.get(im.format, "")
            if mime not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
                raise ValueError("Unsupported image")
        result = [mime, None]
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Invalid, encrypted, oversized, or unsupported media", file=sys.stderr)
        sys.exit(1)
