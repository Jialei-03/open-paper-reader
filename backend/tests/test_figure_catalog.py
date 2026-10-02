import io
from uuid import uuid4

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import select

from backend.models import AgentRun, AgentSession, User
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414


def fixture_pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(612, 792)
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
    stream = DecodedStreamObject()
    stream.set_data(
        b"BT /F1 12 Tf 40 700 Td (Figure 1: Memory architecture) Tj 0 -30 Td (Table 2: Results) Tj ET"
    )
    page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_real_caption_subprocess_cache_and_ownership(env):
    _app, alice, bob, _settings = env
    p = paper(alice)
    f = attach(alice, p, name="captions.pdf", data=fixture_pdf())
    url = f"/api/v1/files/{f['id']}/figure-captions"
    result = alice.get(url)
    assert result.status_code == 200, result.text
    value = result.json()
    assert value["pages_scanned"] == value["total_pages"] == 1
    assert value["items"] == [
        {"page": 1, "quote": "Figure 1: Memory architecture", "kind": "figure"},
        {"page": 1, "quote": "Table 2: Results", "kind": "table"},
    ]
    assert alice.get(url).json() == value
    assert bob.get(url).status_code == 404
    assert bob.get(f"/api/v1/papers/{p['id']}/figure-assets").status_code == 404
    text = attach(alice, p)
    assert alice.get(f"/api/v1/files/{text['id']}/figure-captions").status_code == 422


def test_explanations_only_owned_completed_source_runs(env):
    app, alice, bob, _settings = env
    p = paper(alice)
    f = attach(alice, p, name="captions.pdf", data=fixture_pdf())
    with app.state.maker() as d:
        owner = d.scalar(select(User).where(User.username == "alice")).id
        other = d.scalar(select(User).where(User.username == "bob")).id
        for user in [owner, other]:
            session = AgentSession(owner=user, title="Saved explanations")
            d.add(session)
            d.flush()
            for status in ["completed", "failed"]:
                d.add(
                    AgentRun(
                        owner=user,
                        session_id=session.id,
                        model_config_id="fixture",
                        model="fixture",
                        prompt="Explain memory figure",
                        response="Grounded memory explanation",
                        status=status,
                        runtime={
                            "secret": "do-not-return",
                            "reader_context": {
                                "paper_id": p["id"],
                                "file_id": f["id"],
                                "source": "region",
                                "page": 1,
                            },
                        },
                    )
                )
        d.commit()
    url = f"/api/v1/papers/{p['id']}/explanations"
    result = alice.get(url).json()
    assert len(result["items"]) == 1
    assert "runtime" not in result["items"][0]
    assert "do-not-return" not in str(result)
    assert alice.get(url + "?category=page").json()["items"] == []
    assert len(alice.get(url + "?q=memory&category=region").json()["items"]) == 1
    assert alice.get(url + "?q=%25").json()["items"] == []
    assert bob.get(url).status_code == 404


def test_reading_activity_is_owned_and_contains_failed_work(env):
    app, alice, bob, _ = env
    p = paper(alice)
    f = attach(alice, p, name="source.pdf", data=fixture_pdf())
    with app.state.maker() as d:
        owner = d.scalar(select(User).where(User.username == "alice")).id
        session = AgentSession(owner=owner, title="Explanation")
        d.add(session)
        d.flush()
        for index in range(53):
            d.add(
                AgentRun(
                    owner=owner,
                    session_id=session.id,
                    model_config_id="fixture",
                    model="fixture",
                    prompt="Explain",
                    response=str(index),
                    status="failed",
                    error="Model unavailable",
                    runtime={
                        "secret": "hidden",
                        "reader_context": {
                            "paper_id": p["id"],
                            "file_id": f["id"],
                            "page": 1,
                            "source": "selection",
                        },
                    },
                )
            )
        d.commit()
    url = f"/api/v1/papers/{p['id']}/reading-activity"
    first = alice.get(url).json()
    second = alice.get(url + "?offset=50").json()
    assert len(first["items"]) == 50
    assert first["next"] == 50
    assert len(second["items"]) == 3
    assert second["next"] is None
    assert len({r["id"] for r in first["items"] + second["items"]}) == 53
    assert first["items"][0]["error"] == "Model unavailable"
    assert "hidden" not in str(first)
    assert bob.get(url).status_code == 404


def test_activity_search_and_export_include_unloaded_rows(env):
    app, alice, bob, _ = env
    p = paper(alice)
    f = attach(alice, p, name="source.pdf", data=fixture_pdf())
    from backend.models import TextAnnotation

    with app.state.maker() as d:
        owner = d.scalar(select(User).where(User.username == "alice")).id
        for index in range(65):
            d.add(
                TextAnnotation(
                    id=str(uuid4()),
                    owner=owner,
                    paper_id=p["id"],
                    file_id=f["id"],
                    version_id=f["version_id"],
                    page=1,
                    quote=f"sentence-{index}",
                    comment="Needle 100%_" if index == 0 else "",
                    color="#facc15",
                    size=100,
                    rects=[[0.1, 0.1, 0.2, 0.02]],
                )
            )
        d.commit()
    url = f"/api/v1/papers/{p['id']}/reading-activity"
    assert len(alice.get(url).json()["items"]) == 50
    found = alice.get(url, params={"q": "needle", "kind": "comment"}).json()
    assert len(found["items"]) == 1
    assert found["items"][0]["quote"] == "sentence-0"
    assert alice.get(url, params={"q": "%_"}).json()["items"] == found["items"]
    assert (
        alice.get(url, params={"q": "needle", "kind": "highlight"}).json()["items"]
        == []
    )
    exported = alice.get(url + "/export")
    assert exported.status_code == 200
    assert "共 65 条记录" in exported.text
    assert exported.text.count("[返回原文]") == 65
    assert "sentence-0" in exported.text and "sentence-64" in exported.text
    assert "共 1 条记录" in alice.get(url + "/export", params={"q": "needle"}).text
    assert bob.get(url + "/export").status_code == 404
    assert alice.get(url, params={"kind": "bogus"}).status_code == 422


def test_translation_is_a_separate_kind_from_explanation(env):
    app, alice, bob, _ = env
    p = paper(alice)
    f = attach(alice, p, name="source.pdf", data=fixture_pdf())
    context = {
        "paper_id": p["id"],
        "file_id": f["id"],
        "page": 1,
        "source": "selection",
    }
    runs = [
        # New snapshots record what the reader asked for.
        ("Explain", {**context, "action": "explain"}),
        ("Anything", {**context, "action": "translate"}),
        # Snapshots from before the action existed are told apart by their prompt.
        ("请将所选文字翻译成中文，保留公式、术语和引用编号。", context),
        (
            "请读取所选区域并翻译成中文，保留段落结构。",
            {**context, "source": "region", "rect": [0.1, 0.2, 0.3, 0.4]},
        ),
        ("请结合论文上下文解释所选文字，说明概念。", context),
        (
            "请读取当前论文页面并解释这个图表，与其中的中文翻译无关。",
            {**context, "source": "page"},
        ),
    ]
    with app.state.maker() as d:
        owner = d.scalar(select(User).where(User.username == "alice")).id
        session = AgentSession(owner=owner, title="Reading")
        d.add(session)
        d.flush()
        for index, (prompt, reader_context) in enumerate(runs):
            d.add(
                AgentRun(
                    owner=owner,
                    session_id=session.id,
                    model_config_id="fixture",
                    model="fixture",
                    prompt=prompt,
                    response=f"answer {index}",
                    status="completed",
                    runtime={"reader_context": reader_context},
                )
            )
        d.commit()
    url = f"/api/v1/papers/{p['id']}/reading-activity"
    translated = alice.get(url + "?kind=translation").json()["items"]
    explained = alice.get(url + "?kind=explanation").json()["items"]
    assert sorted(row["body"] for row in translated) == [
        "answer 1",
        "answer 2",
        "answer 3",
    ]
    assert sorted(row["body"] for row in explained) == [
        "answer 0",
        "answer 4",
        "answer 5",
    ]
    assert {row["kind"] for row in translated} == {"translation"}
    assert {row["kind"] for row in explained} == {"explanation"}
    assert len(alice.get(url).json()["items"]) == 6
    exported = alice.get(url + "/export?kind=translation").text
    assert "## 翻译 · 第 1 页" in exported and "解释与翻译" not in exported
    assert bob.get(url + "?kind=translation").status_code == 404


def test_activity_categories_filter_before_pagination_and_keep_region(env):
    app, alice, bob, _ = env
    p = paper(alice)
    f = attach(alice, p, name="source.pdf", data=fixture_pdf())
    with app.state.maker() as d:
        owner = d.scalar(select(User).where(User.username == "alice")).id
        session = AgentSession(owner=owner, title="Categories")
        d.add(session)
        d.flush()
        for category, count in [("formula", 52), ("url", 1), ("text", 1)]:
            for index in range(count):
                d.add(
                    AgentRun(
                        owner=owner,
                        session_id=session.id,
                        model_config_id="fixture",
                        model="fixture",
                        prompt=f"Explain {category}",
                        response=f"{category} {index}",
                        status="completed",
                        runtime={
                            "reader_context": {
                                "paper_id": p["id"],
                                "file_id": f["id"],
                                "page": 1,
                                "source": "region",
                                "category": category,
                                "rect": [0.1, 0.2, 0.3, 0.4],
                            }
                        },
                    )
                )
        d.commit()
    url = f"/api/v1/papers/{p['id']}/reading-activity"
    first = alice.get(url + "?kind=explanation&category=formula").json()
    second = alice.get(url + "?kind=explanation&category=formula&offset=50").json()
    assert first["next"] == 50 and second["next"] is None
    assert len(first["items"]) == 50 and len(second["items"]) == 2
    assert all(row["category"] == "formula" for row in first["items"])
    assert first["items"][0]["region"] == [0.1, 0.2, 0.3, 0.4]
    assert len(alice.get(url + "?category=url").json()["items"]) == 1
    assert alice.get(url + "?category=invalid").status_code == 422
    assert bob.get(url + "?category=formula").status_code == 404
    exported = alice.get(url + "/export?kind=explanation&category=url")
    assert exported.status_code == 200
    assert "url 0" in exported.text and "formula 0" not in exported.text


def test_remove_and_clear_history_preserve_conversation_and_scope(env):
    app, alice, bob, _ = env
    p = paper(alice)
    other = paper(alice)
    f = attach(alice, p, name="history.pdf", data=fixture_pdf())
    with app.state.maker() as d:
        owner = d.scalar(select(User).where(User.username == "alice")).id
        session = AgentSession(owner=owner, title="Paper discussion")
        d.add(session)
        d.flush()
        rows = []
        for index, (action, status, paper_id) in enumerate(
            [
                ("translate", "completed", p["id"]),
                ("translate", "completed", p["id"]),
                ("translate", "running", p["id"]),
                ("explain", "completed", p["id"]),
                ("translate", "completed", other["id"]),
            ]
        ):
            row = AgentRun(
                owner=owner,
                session_id=session.id,
                model_config_id="fixture",
                model="fixture",
                prompt="task",
                response=f"result-{index}",
                status=status,
                runtime={
                    "reader_context": {
                        "paper_id": paper_id,
                        "file_id": f["id"],
                        "action": action,
                        "source": "selection",
                        "page": 1,
                    }
                },
            )
            d.add(row)
            rows.append(row)
        d.commit()
        ids = [row.id for row in rows]
    url = f"/api/v1/papers/{p['id']}/reading-activity"
    assert bob.delete(url + f"/{ids[0]}").status_code == 404
    assert alice.delete(url + f"/{ids[4]}").status_code == 404
    assert alice.delete(url + f"/{ids[2]}").status_code == 409
    assert alice.delete(url + f"/{ids[0]}").status_code == 200
    assert ids[0] not in [r["id"] for r in alice.get(url).json()["items"]]
    assert "result-0" not in alice.get(url + "/export").text
    assert alice.delete(
        url, params={"kind": "translation", "q": "result-1"}
    ).json() == {"removed": 1}
    remaining = alice.get(url).json()["items"]
    assert {r["id"] for r in remaining} == {ids[2], ids[3]}
    assert alice.delete(url, params={"kind": "all"}).status_code == 422
    assert alice.delete(url, params={"kind": "translation"}).json() == {"removed": 0}
    with app.state.maker() as d:
        assert all(d.get(AgentRun, id) is not None for id in ids)
        assert d.get(AgentRun, ids[0]).response == "result-0"
        assert not d.get(AgentRun, ids[2]).runtime.get("activity_hidden")
        assert not d.get(AgentRun, ids[4]).runtime.get("activity_hidden")
    page = alice.get(url, params={"limit": 1}).json()
    assert len(page["items"]) == 1
    assert page["next"] == 1
