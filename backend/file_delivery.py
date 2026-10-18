"""Authenticated, bounded-memory file delivery with single byte-range support."""
import os
import re
import stat
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse


def file_response(settings, record, request, download=False):
    # Open once without following symlinks: the verified descriptor is the one read.
    try:
        fd = os.open(Path(settings.storage) / record.id, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        stream = os.fdopen(fd, "rb")
    except OSError:
        raise HTTPException(404, "File missing or unsafe; restore from backup")
    info = os.fstat(stream.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_size != record.size:
        stream.close()
        raise HTTPException(404, "File missing or unsafe; restore from backup")
    etag = '"' + record.sha256 + '"'
    headers = {
        "ETag": etag,
        "Accept-Ranges": "bytes",
        # A file id never changes its bytes, so the browser may keep them (private
        # only: never a shared cache); the owner check runs on every uncached request.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Vary": "Cookie, Authorization",
        "Content-Disposition": f"{'attachment' if download else 'inline'}; filename=\"attachment\"; filename*=UTF-8''{quote(record.name, safe='')}",
    }
    validators = request.headers.get("if-none-match", "").split(",")
    if any(value.strip().removeprefix("W/") in (etag, "*") for value in validators):
        stream.close()
        return Response(status_code=304, headers=headers)
    start, end, status = 0, info.st_size, 200
    value = request.headers.get("range", "")
    # Multiple ranges may be ignored per HTTP; PDF.js requests single ranges.
    if value and request.headers.get("if-range", etag) == etag and "," not in value:
        # Bound numeric conversion before int(): hostile thousands-digit values
        # must not trigger Python's integer-string limit or expensive conversion.
        match = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", value.strip())
        if match and any(match.groups()):
            first, last = match.groups()
            start = int(first) if first else max(0, end - int(last))
            end = min(end, int(last) + 1) if first and last else end
            if start >= end or start >= info.st_size:
                stream.close()
                headers["Content-Range"] = f"bytes */{info.st_size}"
                return Response(status_code=416, headers=headers)
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end - 1}/{info.st_size}"
    headers["Content-Length"] = str(end - start)
    if request.method == "HEAD":
        stream.close()
        return Response(status_code=status, headers=headers, media_type=record.mime)

    def chunks():
        try:
            stream.seek(start)
            remaining = end - start
            while remaining:
                chunk = stream.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
        finally:
            stream.close()

    return StreamingResponse(
        chunks(), status_code=status, headers=headers, media_type=record.mime,
        background=BackgroundTask(stream.close),
    )
