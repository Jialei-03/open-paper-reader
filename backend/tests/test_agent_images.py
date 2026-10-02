import io
import tarfile

import pytest
from PIL import Image

from backend.agent_images import inspect, list_images, view
from backend.models import Paper, TranslationJob
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import configure, pdf_bytes
from backend.translations import store_file


def archive_bytes(name, raw, link=False):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as tar:
        member = tarfile.TarInfo(name)
        member.size = len(raw)
        if link:
            member.type = tarfile.SYMTYPE
            member.linkname = "/etc/passwd"
        tar.addfile(member, io.BytesIO(raw))
    return out.getvalue()


def test_owned_source_images_and_resource_limits(env):
    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    p = paper(a)
    image = Image.new("RGB", (320, 200), "red")
    out = io.BytesIO()
    image.save(out, "PNG")
    raw = out.getvalue()
    f = attach(a, p, "chart.png", raw)
    preview = view(app, owner, f["id"])
    assert preview["images"][0]["width"] == 320
    assert preview["images"][0]["label"] == "chart.png"
    assert (
        Image.open(io.BytesIO(a.get(preview["images"][0]["url"]).content)).getpixel(
            (0, 0)
        )[0]
        > 240
    )
    assert b.get(preview["images"][0]["url"]).status_code == 404
    with pytest.raises(ValueError, match="整数"):
        view(app, owner, f["id"], page=1.5)
    with pytest.raises(ValueError, match="只有一页"):
        view(app, owner, f["id"], page=2)
    source = archive_bytes("figures/architecture.png", raw)
    with app.state.maker() as d:
        record = d.get(Paper, p["id"])
        ar = store_file(
            d, settings, record, record.current_version, "source.tar.gz", source
        )
        ar_id = ar.id
        d.add(
            TranslationJob(
                owner=owner,
                paper_id=p["id"],
                version_id=record.current_version,
                source_archive=ar_id,
                arxiv_id="2601.00001v1",
            )
        )
        d.commit()
    listed = list_images(app, owner, p["id"])
    assert listed["source_images"] == [
        {"id": ar_id, "asset": "figures/architecture.png", "supported": True}
    ]
    preview = view(app, owner, ar_id, asset="figures/architecture.png")
    assert a.get(preview["images"][0]["url"]).status_code == 200
    assert b.get(preview["images"][0]["url"]).status_code == 404
    with pytest.raises(ValueError, match="没有这张"):
        view(app, owner, ar_id, asset="../../etc/passwd")
    for name, symlink in [("../bad.png", False), ("fig.png", True)]:
        with app.state.maker() as d:
            ar = store_file(
                d,
                settings,
                d.get(Paper, p["id"]),
                p["current_version"],
                "bad.tar.gz",
                archive_bytes(name, raw, symlink),
            )
            d.commit()
            bad_id = ar.id
        with pytest.raises(ValueError, match="不安全"):
            inspect(settings, bad_id, operation="list")
    scan = attach(a, p, "scan.pdf", pdf_bytes(False))
    assert view(app, owner, scan["id"])["images"][0]["height"] > 1000
    with pytest.raises(ValueError, match="页码"):
        view(app, owner, scan["id"], page=13)
    # The capability flag is explicit, persists across editing and never leaks keys.
    cfg = a.put(
        "/api/v1/translation-settings",
        json={
            "id": model,
            "base_url": "https://api.minimax.cn/v1",
            "model": "MiniMax-M3",
            "vision": True,
        },
    ).json()
    row = next(row for row in cfg["models"] if row["id"] == model)
    assert row["vision"] is True and "api_key" not in row


@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
def test_vision_probe_requires_image_answer(env, monkeypatch, protocol):
    import backend.translation_settings as configs

    app, a, b, settings = env
    owner, model = configure(app, a, settings)
    config = configs.read_config(settings, owner, model)
    configs.write_config(settings, owner, {**config, "protocol": protocol})
    # Verify the challenge is carried in binary pixels, with the correct protocol.
    answers = []
    original = ImageDraw = __import__("PIL.ImageDraw", fromlist=["ImageDraw"]).ImageDraw
    text = original.text

    def capture(self, xy, value, *args, **kwargs):
        answers.append(value)
        return text(self, xy, value, *args, **kwargs)

    monkeypatch.setattr(ImageDraw, "text", capture)

    def complete(config, system, content):
        assert answers[-1] not in system + content[0]["text"]
        image = content[1]
        assert image["type"] == ("image" if protocol == "anthropic" else "image_url")
        return answers[-1]

    monkeypatch.setattr(configs, "complete", complete)
    path = f"/api/v1/translation-settings/configs/{model}/vision-test"
    assert b.post(path).status_code == 404
    response = a.post(path)
    assert response.status_code == 200
    assert response.json()["models"][0]["vision"] is True
    monkeypatch.setattr(configs, "complete", lambda *args: "OK")
    assert a.post(path).status_code == 502


def test_region_pixels_pdf_rotation_and_owner(env):
    from PIL import ImageDraw
    from pypdf import PdfReader, PdfWriter

    from backend.agent_images import normalize_rect

    app, a, b, settings = env
    owner, _ = configure(app, a, settings)
    p = paper(a)
    original = Image.new("RGB", (400, 600), "white")
    draw = ImageDraw.Draw(original)
    draw.rectangle((0, 0, 199, 299), fill="red")
    draw.rectangle((200, 0, 399, 299), fill="blue")
    draw.rectangle((0, 300, 199, 599), fill="green")
    raw = io.BytesIO()
    original.save(raw, "PDF")
    for rotation in (0, 90):
        writer = PdfWriter()
        page = PdfReader(io.BytesIO(raw.getvalue())).pages[0]
        page.rotate(rotation)
        writer.add_page(page)
        output = io.BytesIO()
        writer.write(output)
        f = attach(a, p, f"colors-{rotation}.pdf", output.getvalue())
        whole = view(app, owner, f["id"])
        full = Image.open(io.BytesIO(a.get(whole["images"][0]["url"]).content))
        crop = view(app, owner, f["id"], rect=[0, 0, 0.5, 0.5])
        response = a.get(crop["images"][0]["url"])
        assert response.status_code == 200
        cut = Image.open(io.BytesIO(response.content))
        expected = full.getpixel((full.width // 4, full.height // 4))
        actual = cut.getpixel((cut.width // 2, cut.height // 2))
        assert max(abs(x - y) for x, y in zip(expected, actual)) < 10
        assert b.get(crop["images"][0]["url"]).status_code == 404
        assert crop["images"][0]["url"] != whole["images"][0]["url"]
        with pytest.raises(ValueError, match="太小"):
            view(app, owner, f["id"], rect=[0, 0, 0.00001, 0.00001])
    for invalid in (
        [True, 0, 1, 1],
        [0, 0, float("nan"), 1],
        [0, 0, 0, 1],
        [0.5, 0, 0.7, 1],
    ):
        with pytest.raises(ValueError):
            normalize_rect(invalid)


def test_parallel_previews_wait_for_renderer(env):
    from concurrent.futures import ThreadPoolExecutor

    app, a, _b, settings = env
    _owner, _ = configure(app, a, settings)
    p = paper(a)
    ids = []
    for color in ("red", "blue"):
        raw = io.BytesIO()
        Image.new("RGB", (32, 32), color).save(raw, "PNG")
        ids.append(attach(a, p, color + ".png", raw.getvalue())["id"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        values = list(pool.map(lambda id: inspect(settings, id), ids))
    assert all(value["width"] == 32 for value in values)
