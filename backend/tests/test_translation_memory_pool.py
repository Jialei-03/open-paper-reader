import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.models import File, TranslationMemory, User
from backend.tests.test_acceptance import attach, paper
from backend.tests.test_acceptance import env as env  # noqa: PLC0414
from backend.tests.test_agents import pdf_bytes
from backend.translation_memory import SentenceMemory


def test_memory_checkpoint_and_cancel_check_work_with_one_connection(env, monkeypatch):
    app, client, _, settings = env
    document = paper(client)
    source = attach(client, document, "paper.pdf", pdf_bytes())
    with app.state.maker() as d:
        owner = d.scalar(select(User.id).where(User.username == "alice"))
    engine = create_engine(
        settings.database_url, pool_size=1, max_overflow=0, pool_timeout=0.5
    )
    maker = sessionmaker(engine, expire_on_commit=False)

    def cancelled():
        # This is the actual worker contract: cancellation reads persistent state.
        with maker() as d:
            assert d.get(User, owner)
        return False

    def complete(cfg, system, content, **kwargs):
        return json.dumps(
            {
                "sentences": [
                    {"id": row["id"], "kind": "text", "translation": "已验证中文译文。"}
                    for row in json.loads(content)
                ]
            }
        )

    monkeypatch.setattr("backend.translation_memory.complete", complete)
    memory = SentenceMemory(
        settings,
        maker,
        owner,
        source["sha256"],
        {"model": "fixture", "base_url": "https://api.openai.com/v1"},
        cancelled=cancelled,
    )
    try:
        with ThreadPoolExecutor(2) as tasks:
            results = list(
                tasks.map(
                    lambda text: memory.translate([text]),
                    [
                        "First complete scientific sentence.",
                        "Second complete scientific sentence.",
                    ],
                )
            )
        assert all(result[0]["translation"] == "已验证中文译文。" for result in results)
        memory.remember(
            [
                {
                    "original": "Legacy source sentence.",
                    "translation": "旧译文。",
                    "kind": "text",
                }
            ]
        )
        with maker() as d:
            assert len(list(d.scalars(select(TranslationMemory)))) == 3
        # A fresh worker reads the durable checkpoint without provider calls.
        monkeypatch.setattr(
            "backend.translation_memory.complete",
            lambda *a, **k: (_ for _ in ()).throw(AssertionError("No duplicate call")),
        )
        assert (
            memory.translate(["First complete scientific sentence."])[0]["translation"]
            == "已验证中文译文。"
        )
        with maker() as d:
            d.delete(d.get(File, source["id"]))
            d.commit()
        with pytest.raises(ValueError, match="原文已删除"):
            memory.remember(
                [
                    {
                        "original": "After deletion.",
                        "translation": "删除后。",
                        "kind": "text",
                    }
                ]
            )
        with maker() as d:
            assert len(list(d.scalars(select(TranslationMemory)))) == 3
    finally:
        engine.dispose()
