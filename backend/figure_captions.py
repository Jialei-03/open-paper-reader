"""Runs only inside visual_media's time/memory-limited subprocess."""

import re

CAPTION = re.compile(
    r"^\s*((?:Figure|Fig\.?|Table)\s+[A-Z]?\d+(?:\.\d+)*[.:]?\s*[^\r\n]{0,300}|[图表]\s*[A-Z]?\d+(?:\.\d+)*[.:：]?\s*[^\r\n]{0,300})",
    re.IGNORECASE | re.MULTILINE,
)


def extract(raw):
    import pypdfium2 as pdfium

    # The format allows stray bytes before the header, within the first 1024.
    if b"%PDF-" not in raw[:1024]:
        raise ValueError("附件不是 PDF")
    rows = []
    with pdfium.PdfDocument(raw) as pdf:
        count = len(pdf)
        scanned = min(count, 200)
        for number in range(scanned):
            page = pdf[number]
            text = page.get_textpage()
            try:
                content = text.get_text_range()
            finally:
                text.close()
                page.close()
            for match in CAPTION.finditer(content):
                quote = match.group(1).strip()
                rows.append(
                    {
                        "page": number + 1,
                        "quote": quote,
                        "kind": "table"
                        if re.match(r"(?:Table|表)", quote, re.IGNORECASE)
                        else "figure",
                    }
                )
                if len(rows) >= 500:
                    return {
                        "items": rows,
                        "pages_scanned": number + 1,
                        "total_pages": count,
                        "limited": True,
                    }
        return {
            "items": rows,
            "pages_scanned": scanned,
            "total_pages": count,
            "limited": scanned < count,
        }
