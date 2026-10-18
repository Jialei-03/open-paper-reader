"""Starts a localhost-only server against a disposable, unseeded test workspace."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
# Match production WorkingDirectory so isolated Python workers resolve backend.
os.chdir(root)
if not os.getenv("E2E_TEST_PASSWORD"):
    raise SystemExit("Run through Playwright; test password is generated per run")
with tempfile.TemporaryDirectory(prefix="paper-platform-e2e-") as directory:
    os.environ["DATABASE_URL"] = "sqlite:///" + directory + "/test.db"
    os.environ["STORAGE_DIR"] = directory + "/files"
    port = int(os.environ.get("E2E_PORT", "8766"))
    os.environ["APP_ORIGIN"] = f"http://127.0.0.1:{port}"
    os.environ["APP_ENV"] = "development"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, check=True
    )
    from backend.config import Settings, database
    from backend.main import PASSWORD
    from backend.models import User

    _, maker = database(Settings.env())
    with maker() as d:
        for name in ("alice", "bob"):
            d.add(
                User(
                    username=name,
                    email=name + "@browser.example",
                    password=PASSWORD.hash(os.environ["E2E_TEST_PASSWORD"]),
                    admin=name == "alice",
                )
            )
        d.commit()
    import re

    # Each Playwright browser context models a separate client. Preserve the real
    # 30-attempt authentication budget within a context, without charging every
    # independent test's successful login to the same localhost address.
    import secrets

    from backend.main import app

    @app.middleware("http")
    async def isolated_browser_client(request, call_next):
        client = request.cookies.get("e2e_browser_client", "")
        if not re.fullmatch(r"[0-9a-f]{32}", client):
            client = secrets.token_hex(16)
        request.scope["client"] = ("e2e-browser-" + client, 0)
        response = await call_next(request)
        response.set_cookie(
            "e2e_browser_client", client, httponly=True, samesite="strict"
        )
        return response

    # External feed fixture exists only in the disposable browser test server.
    def discovery_fixture(terms):
        if "test-discovery-memory" not in terms:
            return []
        return [
            {
                "external_id": "arxiv:9901.00001",
                "title": "Synthetic discovery memory paper",
                "abstract": "test-discovery-memory; deterministic browser fixture",
                "authors": "Test Author",
                "published": "2026-01-01",
                "url": "https://arxiv.org/abs/9901.00001",
            }
        ]

    app.state.discovery_fetcher = discovery_fixture

    def citation_fixture(identifier, relation, offset):
        if identifier != "ARXIV:9901.00003":
            from fastapi import HTTPException

            raise HTTPException(404, "公开引用库尚未收录这篇论文")
        return {
            "items": [
                {
                    "title": (
                        "Synthetic reference "
                        if relation == "references"
                        else "Synthetic citing paper "
                    )
                    + str(offset),
                    "authors": ["Citation Test Author"],
                    "abstract": "Deterministic source abstract for citation verification.",
                    "year": 2026,
                    "doi": "10.1234/test-" + relation + "-" + str(offset),
                    "arxiv": "9901.00002" if offset == 0 else "",
                    "s2_id": "a" * 39 + str(offset // 50),
                }
            ],
            "next": 50 if offset == 0 else None,
            "source": "Semantic Scholar",
        }

    app.state.citation_fetcher = citation_fixture

    # Keep this synthetic recommendation's PDF import deterministic and offline.
    import io

    from pypdf import PdfWriter

    from backend import translations

    original_metadata, original_download = translations.metadata, translations.download

    def discovery_metadata(url):
        from backend.arxiv_import import identifier

        fixture_titles = {
            "9901.00001": "Synthetic discovery memory paper",
            "9901.00002": "Synthetic citation imported paper",
            "9901.00003": "Synthetic citation source paper",
        }
        archive_id = re.sub(r"v\d+$", "", identifier(url))
        if archive_id not in fixture_titles:
            return original_metadata(url)
        return {
            "arxiv_id": archive_id + "v1",
            "title": fixture_titles[archive_id],
            "authors": "Test Author",
            "abstract": "test-discovery-memory; deterministic browser fixture",
        }

    def discovery_download(path, *args, **kwargs):
        if path not in {"/pdf/9901.00001v1", "/pdf/9901.00002v1", "/pdf/9901.00003v1"}:
            return original_download(path, *args, **kwargs)
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()

    translations.metadata = discovery_metadata
    translations.download = discovery_download
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
