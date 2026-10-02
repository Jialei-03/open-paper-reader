"""Content-named static files are cached for good; everything else is never cached."""

from pathlib import Path

import pytest

from backend.asset_cache import static_cache_control
from backend.tests.test_acceptance import env as env  # noqa: PLC0414

LONG = "public, max-age=31536000, immutable"


@pytest.mark.parametrize(
    "path",
    [
        "/assets/index-BxrTMyM-.js",
        "/assets/index-ClTZkm_k.css",
        "/assets/vendor-react-iDmmTQ2Q.js",
        "/assets/pdf.worker.min-r-TJsTTt.mjs",
        "/assets/noto-sans-sc-97-wght-normal-BsBHkXi3.woff2",
        "/assets/KaTeX_Size3-Regular-gV2CO0n9.woff2",
    ],
)
def test_build_output_is_cached_for_good(path):
    assert static_cache_control(path) == LONG


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/index.html",
        "/api/v1/papers",
        "/api/v1/files/abc/content",
        "/api/v1/shared/token",
        "/assets/index.js",  # no content hash in the name
        "/assets/sub/dir-BxrTMyM-.js",  # only files directly under /assets carry build hashes
        "/library",
    ],
)
def test_pages_and_api_are_never_cached(path):
    assert static_cache_control(path) is None


def test_fixed_name_assets_are_cached_for_a_day():
    for path in (
        "/assets/icons/zhijian-book-v5.svg",
        "/assets/showcase/hero-explain.webp",
        "/assets/pdfjs/cmaps/UniGB-UCS2-H.bcmap",
    ):
        assert static_cache_control(path) == "public, max-age=86400"


def test_the_server_applies_the_policy(env):
    _app, alice, _, _ = env
    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    built = sorted((dist / "assets").glob("index-*.js")) if dist.is_dir() else []
    if not built:
        pytest.skip("the frontend is not built")
    file = built[0].name
    response = alice.get(f"/assets/{file}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == LONG
    # The page that names the files, API answers and missing files stay uncached.
    assert alice.get("/library").headers["cache-control"] == "no-store"
    assert alice.get("/api/v1/health").headers["cache-control"] == "no-store"
    assert (
        alice.get("/assets/missing-AAAAAAAA.js").headers["cache-control"] == "no-store"
    )
