"""Cache policy for the built frontend's static files.

Everything the API returns is private and never cached. The files under /assets
are public and are named by content: a build gives each file a hash, so a file
with a given name never changes and can be kept for good, while the page that
names it (index.html) is never cached and always points at the current names.
Without this a returning visitor re-downloads the whole app on every visit.
"""

import re

# Vite names build output "<name>-<8 chars of content hash>.<ext>" directly under /assets.
HASHED = re.compile(r"/assets/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+")
# Fixed names that change rarely (icons carry a version in the name).
STATIC_FOLDERS = (
    "/assets/fonts/",
    "/assets/icons/",
    "/assets/pdfjs/",
    "/assets/showcase/",
)


def static_cache_control(path: str) -> str | None:
    """Cache-Control for a static file path, or None to keep the default (no-store)."""
    if HASHED.fullmatch(path):
        return "public, max-age=31536000, immutable"
    if path.startswith(STATIC_FOLDERS):
        return "public, max-age=86400"
    return None
