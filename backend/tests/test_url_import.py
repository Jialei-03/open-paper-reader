"""Importing by address: what is fetched, and above all what is refused.

DNS and HTTP are both replaced: names resolve through a table, and requests
reach a handler by the Host header (the real code connects to the checked
address itself, so the URL a mock sees holds the address, not the name).
"""

from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from backend import url_import
from backend.models import File, Paper
from backend.tests import hard_pdfs
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_acceptance import write

PDF = hard_pdfs.text_pdf()
PUBLIC = "93.184.216.34"


@pytest.fixture
def web(monkeypatch):
    """`web.sites[host] = handler(request) -> Response`; `web.dns[host] = [ips]`."""

    Web = SimpleNamespace(sites={}, dns={}, seen=[])

    real = httpx.Client

    def respond(request):
        host = request.headers["host"].split(":")[0]
        Web.seen.append((host, request.url.host, str(request.url.path)))
        return Web.sites[host](request)

    def lookup(host, port):
        if host not in Web.dns:
            raise url_import.Refused("找不到这个网址，请检查链接")
        return Web.dns[host]

    monkeypatch.setattr(
        url_import.httpx,
        "Client",
        lambda **kw: real(transport=httpx.MockTransport(respond), **kw),
    )
    monkeypatch.setattr(url_import, "resolve", lookup)
    return Web


def pdf_response(body=PDF, **headers):
    return httpx.Response(
        200, content=body, headers={"content-type": "application/pdf", **headers}
    )


def page(head):
    return httpx.Response(
        200,
        content=f"<html><head>{head}</head><body>x</body></html>".encode(),
        headers={"content-type": "text/html; charset=utf-8"},
    )


def do_import(c, url):
    return write(c, "/import/url", {"url": url})


def test_a_direct_pdf_link_is_imported_once(env, web):
    _app, a, _b, _s = env
    web.dns["files.example.org"] = [PUBLIC]
    web.sites["files.example.org"] = lambda r: pdf_response()
    first = do_import(a, "https://files.example.org/papers/deep_nets_2024.pdf")
    assert first.status_code == 200, first.text
    assert first.json()["title"] == "deep nets 2024"
    # The request went to the checked address, not to a second lookup.
    assert web.seen[0][:2] == ("files.example.org", PUBLIC)
    again = do_import(a, "https://files.example.org/other/name.pdf")
    assert again.json()["id"] == first.json()["id"]  # same bytes: same paper
    files = a.get(f"/api/v1/papers/{first.json()['id']}/files").json()
    assert len(files) == 1 and files[0]["mime"] == "application/pdf"


def test_a_landing_page_with_citation_pdf_url(env, web):
    _app, a, _b, _s = env
    web.dns.update({"journal.example.com": [PUBLIC], "cdn.example.com": [PUBLIC]})
    web.sites["journal.example.com"] = lambda r: page(
        '<meta name="citation_title" content="Attention in Practice">'
        '<meta name="citation_author" content="Ada Lovelace">'
        '<meta name="citation_author" content="Alan Turing">'
        '<meta name="citation_doi" content="10.1234/ABC.5">'
        '<meta name="citation_pdf_url" content="https://cdn.example.com/x/p.pdf">'
    )
    web.sites["cdn.example.com"] = lambda r: pdf_response()
    r = do_import(a, "https://journal.example.com/article/5")
    assert r.status_code == 200, r.text
    paper = r.json()
    assert paper["title"] == "Attention in Practice"
    assert paper["authors"] == "Ada Lovelace; Alan Turing"
    assert paper["external_id"] == "doi:10.1234/abc.5"
    # A relative citation_pdf_url works too, and a repeat finds the DOI.
    web.sites["journal.example.com"] = lambda r: (
        page(
            '<meta name="citation_doi" content="doi:10.1234/abc.5">'
            '<meta name="citation_pdf_url" content="/pdf/5">'
        )
        if r.url.path == "/article/5"
        else pdf_response(PDF + b"\n% different bytes")
    )
    again = do_import(a, "https://journal.example.com/article/5")
    assert again.json()["id"] == paper["id"]


def test_a_page_without_a_pdf_link_says_so(env, web):
    _app, a, _b, _s = env
    web.dns["paywalled.example.com"] = [PUBLIC]
    web.sites["paywalled.example.com"] = lambda r: page(
        '<meta name="citation_title" content="Locked">'
    )
    r = do_import(a, "https://paywalled.example.com/a")
    assert r.status_code == 422
    assert r.json()["detail"] == url_import.NO_PDF_LINK
    web.sites["paywalled.example.com"] = lambda r: httpx.Response(403)
    assert do_import(a, "https://paywalled.example.com/b").json()["detail"] == (
        url_import.PAYWALL
    )


def test_not_a_pdf_and_oversized(env, web, monkeypatch):
    _app, a, _b, _s = env
    web.dns["h.example.com"] = [PUBLIC]
    web.sites["h.example.com"] = lambda r: httpx.Response(
        200, content=b"MZ" + b"0" * 5000, headers={"content-type": "application/pdf"}
    )
    r = do_import(a, "https://h.example.com/x.pdf")
    assert r.status_code == 422 and "不是 PDF" in r.json()["detail"]
    monkeypatch.setattr(url_import, "PDF_LIMIT", 1000)
    web.sites["h.example.com"] = lambda r: pdf_response()
    big = do_import(a, "https://h.example.com/y.pdf")
    assert big.status_code == 422 and "50 MB" in big.json()["detail"]
    # Also when the server does not announce the length.
    web.sites["h.example.com"] = lambda r: httpx.Response(
        200,
        content=iter([PDF[:600], PDF[600:]]),
        headers={"content-type": "application/pdf"},
    )
    assert "50 MB" in do_import(a, "https://h.example.com/z.pdf").json()["detail"]


@pytest.mark.parametrize(
    "address",
    [
        "10.0.0.5",
        "192.168.1.1",
        "172.16.3.4",
        "127.0.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:10.0.0.1",
        "224.0.0.1",
    ],
)
def test_private_addresses_are_refused(env, web, address):
    _app, a, _b, _s = env
    web.dns["evil.example.com"] = [address]
    web.sites["evil.example.com"] = lambda r: pdf_response()
    r = do_import(a, "https://evil.example.com/x.pdf")
    assert r.status_code == 422 and r.json()["detail"] == url_import.NOT_ALLOWED
    assert web.seen == []


def test_a_name_with_any_private_answer_is_refused(env, web):
    _app, a, _b, _s = env
    web.dns["mixed.example.com"] = [PUBLIC, "10.1.1.1"]
    web.sites["mixed.example.com"] = lambda r: pdf_response()
    assert do_import(a, "https://mixed.example.com/x.pdf").status_code == 422
    assert web.seen == []


@pytest.mark.parametrize(
    "url",
    [
        "http://files.example.org/x.pdf",
        "ftp://files.example.org/x.pdf",
        "file:///etc/passwd",
        "https://user:pw@files.example.org/x.pdf",
        "https://files.example.org:8443/x.pdf",
        "https://127.0.0.1/x.pdf",
        "https://[::1]/x.pdf",
        "http://169.254.169.254/latest/meta-data/",
        "https://localhost/x.pdf",
    ],
)
def test_other_schemes_ports_and_hosts_are_refused(env, web, url):
    _app, a, _b, _s = env
    web.dns.update({"files.example.org": [PUBLIC], "localhost": ["127.0.0.1"]})
    web.sites["files.example.org"] = lambda r: pdf_response()
    r = do_import(a, url)
    assert r.status_code == 422
    assert web.seen == []


def test_a_redirect_to_a_private_address_is_refused(env, web):
    _app, a, _b, _s = env
    web.dns.update(
        {"short.example.com": [PUBLIC], "internal.example.com": ["10.0.0.9"]}
    )
    web.sites["short.example.com"] = lambda r: httpx.Response(
        302, headers={"location": "https://internal.example.com/secret.pdf"}
    )
    web.sites["internal.example.com"] = lambda r: pdf_response()
    r = do_import(a, "https://short.example.com/go")
    assert r.status_code == 422 and r.json()["detail"] == url_import.NOT_ALLOWED
    assert [s[0] for s in web.seen] == ["short.example.com"]
    # ...and to a plain-http or metadata address.
    web.sites["short.example.com"] = lambda r: httpx.Response(
        302, headers={"location": "http://169.254.169.254/latest/"}
    )
    assert do_import(a, "https://short.example.com/go2").status_code == 422


def test_redirects_are_followed_up_to_five(env, web):
    _app, a, _b, _s = env
    web.dns["r.example.com"] = [PUBLIC]

    def hop(request):
        n = int(request.url.path.strip("/") or 0)
        if n < hops:
            return httpx.Response(301, headers={"location": f"/{n + 1}"})
        return pdf_response()

    web.sites["r.example.com"] = hop
    hops = 5
    assert do_import(a, "https://r.example.com/0").status_code == 200
    hops = 6
    web.seen.clear()
    r = do_import(a, "https://r.example.com/0")
    assert r.status_code == 422 and "跳转" in r.json()["detail"]


def test_arxiv_family_links_use_the_arxiv_import(env, web, monkeypatch):
    _app, a, _b, _s = env
    calls = []

    def fake(d, settings, actor, url, snapshot, **kw):
        calls.append(url)
        return d.scalar(select(Paper).where(Paper.owner == actor["id"])), None

    monkeypatch.setattr(url_import, "import_arxiv_paper", fake)
    write(a, "/papers", {"title": "Anything", "tags": []})
    for link in [
        "https://arxiv.org/pdf/2401.00001v2.pdf",
        "https://www.alphaxiv.org/abs/2401.00001",
        "https://alphaxiv.org/overview/2401.00001v2",
        "https://ar5iv.labs.arxiv.org/html/2401.00001",
        "https://ar5iv.org/abs/hep-th/9901001",
    ]:
        assert do_import(a, link).status_code == 200, link
    assert calls == [
        "https://arxiv.org/abs/2401.00001v2",
        "https://arxiv.org/abs/2401.00001",
        "https://arxiv.org/abs/2401.00001v2",
        "https://arxiv.org/abs/2401.00001",
        "https://arxiv.org/abs/hep-th/9901001",
    ]
    assert web.seen == []  # delegated, never fetched here


def test_a_page_whose_pdf_is_on_arxiv_delegates(env, web, monkeypatch):
    _app, a, _b, _s = env
    calls = []
    monkeypatch.setattr(
        url_import,
        "import_arxiv_paper",
        lambda d, s, actor, url, snap, **kw: (
            calls.append(url) or d.scalar(select(Paper)),
            None,
        ),
    )
    write(a, "/papers", {"title": "Anything", "tags": []})
    web.dns["blog.example.com"] = [PUBLIC]
    web.sites["blog.example.com"] = lambda r: page(
        '<meta name="citation_pdf_url" content="https://arxiv.org/pdf/2401.00009">'
    )
    assert do_import(a, "https://blog.example.com/post").status_code == 200
    assert calls == ["https://arxiv.org/abs/2401.00009"]


def test_unreachable_and_invalid(env, web):
    _app, a, _b, _s = env
    assert do_import(a, "https://nowhere.example.com/x.pdf").status_code == 422
    assert do_import(a, "not a link").status_code == 422
    web.dns["slow.example.com"] = [PUBLIC]

    def boom(request):
        raise httpx.ConnectTimeout("slow")

    web.sites["slow.example.com"] = boom
    r = do_import(a, "https://slow.example.com/x.pdf")
    assert r.status_code == 422 and "超时" in r.json()["detail"]


def test_local_mode_allows_127_0_0_1_only(env, web):
    app, a, _b, settings = env
    web.sites["127.0.0.1"] = lambda r: pdf_response()
    assert do_import(a, "http://127.0.0.1:9/x.pdf").status_code == 422  # cloud
    settings.mode = "local"
    try:
        ok = do_import(a, "http://127.0.0.1:9/x.pdf")
        assert ok.status_code == 200, ok.text
        # A name that merely points there is still refused.
        web.dns["rebind.example.com"] = ["127.0.0.1"]
        assert do_import(a, "https://rebind.example.com/x.pdf").status_code == 422
        assert do_import(a, "http://localhost:9/x.pdf").status_code == 422
    finally:
        settings.mode = "cloud"
    assert d_count(app) == 1


def d_count(app):
    with app.state.maker() as d:
        return len(list(d.scalars(select(File))))
