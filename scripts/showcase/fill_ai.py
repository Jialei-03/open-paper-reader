#!/usr/bin/env python
"""Put real model outputs into the demo workspace (no model is called here).

  python scripts/showcase/fill_ai.py artifacts <content.json>   # translations, guide, quiz, ...
  python scripts/showcase/fill_ai.py patch explain|figure|chat|formula|translate|table|compare|organize <content.json>

`artifacts` creates the reading results through the API, as the reader would, and
then records what the model really answered. `patch` completes the newest
queued run of that kind (the one the screenshot script has just started in the
real interface) with the real answer.
"""

import json
import os
import re
import sys
import uuid

import httpx

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from demo_env import demo_password  # noqa: E402

sys.path.insert(0, os.getcwd())
from sqlalchemy import select  # noqa: E402

from backend.config import Settings, database  # noqa: E402
from backend.models import AgentRun, ReadingArtifact, now  # noqa: E402

BASE = os.environ.get("DEMO_API", "http://127.0.0.1:8791") + "/api/v1"
USER = {"username": "linyu", "password": demo_password()}
AMEM = "2502.12110"


def client():
    c = httpx.Client(base_url=BASE, timeout=120)
    login = c.post("/auth/login", json=USER)
    assert login.status_code == 200, login.text
    c.headers["X-CSRF-Token"] = login.json()["csrf"]
    return c


def write(c, method, path, body=None):
    return c.request(method, path, json=body, headers={"Idempotency-Key": str(uuid.uuid4())})


def amem(c):
    for paper in c.get("/papers").json():
        if AMEM in paper["external_id"]:
            files = c.get(f"/papers/{paper['id']}/files").json()
            return paper, next(f for f in files if f["mime"] == "application/pdf")
    raise SystemExit("A-MEM is not in the demo library; run seed.py first")


def artifacts(path):
    content = json.load(open(path))
    c = client()
    paper, file = amem(c)
    model = c.get("/translation-settings").json()["active_id"]
    _, maker = database(Settings.env())
    latest = {}
    for item in content["artifacts"]:
        key = (item["kind"], item["parameters"].get("page"), item["parameters"].get("language"))
        if item["kind"] == "page_translation" and item["parameters"].get("language") != "zh":
            continue
        latest[key] = item
    made = 0
    for (kind, page, language), item in sorted(latest.items(), key=lambda kv: (kv[0][0], kv[0][1] or 0)):
        body = {"file_id": file["id"], "model_config_id": model, "kind": kind}
        if kind == "page_translation":
            body.update(page=page, language="zh")
        elif kind == "quiz":
            body.update(question_count=5)
        r = write(c, "POST", f"/papers/{paper['id']}/reading-artifacts", body)
        assert r.status_code == 200, (kind, page, r.text)
        row = r.json()
        with maker() as d:
            artifact = d.get(ReadingArtifact, row["id"])
            artifact.status, artifact.error = "completed", ""
            artifact.result = item["result"]
            artifact.evidence_pages = item["evidence_pages"] or ([page] if page else [])
            artifact.evidence_text = {}
            artifact.size = len(json.dumps(item["result"], ensure_ascii=False).encode()) + 2048
            artifact.updated_at = now()
            run = d.get(AgentRun, artifact.run_id)
            run.status, run.response = "completed", json.dumps(item["result"], ensure_ascii=False)
            run.runtime = {**(run.runtime or {}), "settled": True, "phase": "completed"}
            run.updated_at = now()
            d.commit()
        made += 1
    print("artifacts completed:", made)


def matches(kind, item, run, context):
    """Is this queued run the one the screenshot script has just started for `kind`?"""
    source, action = context.get("source"), context.get("action")
    if kind == "chat":
        return item["question"][:12] in run.prompt
    if kind == "compare":
        return run.prompt.startswith("请实际读取以下")
    if kind == "organize":
        return run.prompt.startswith(item["prompt"][:20])
    return {
        "explain": (source, action) == ("selection", "explain"),
        "figure": (source, action) == ("region", "explain"),
        "formula": (source, action) == ("region", "formula"),
        "translate": (source, action) == ("selection", "translate"),
        "table": (source, action) == ("region", "translate"),
    }[kind]


def here(d):
    """Where each paper is in this workspace: arXiv number -> its paper, PDF and note ids."""
    from backend.models import File, Item, Paper

    found = {}
    for paper in d.scalars(select(Paper)).all():
        number = re.sub(r"v\d+$", "", paper.external_id.replace("arxiv:", ""))
        pdf = d.scalar(select(File).where(File.paper_id == paper.id, File.mime == "application/pdf"))
        note = d.scalar(select(Item).where(Item.paper_id == paper.id, Item.kind == "note").order_by(Item.created_at))
        found[number] = {"paper": paper.id, "file": pdf.id if pdf else "", "note": note.id if note else ""}
    return found


def remap(value, content, there):
    """The model answered about papers in the scratch database; its links and
    the arguments of its steps name those ids. Point them at this workspace."""
    text = json.dumps(value, ensure_ascii=False)
    for number, ids in content.get("ids", {}).items():
        if number not in there:
            continue
        for key in ("paper", "file", "note"):
            if ids.get(key) and there[number].get(key):
                text = text.replace(ids[key], there[number][key])
    return json.loads(text)


def append_to_note(d, note_id, text):
    """What the assistant's append_note did in the scratch workspace, done here
    to the same note: its text goes on the end and the revision moves on."""
    from backend.models import Item

    note = d.get(Item, note_id)
    note.body = note.body + text
    note.revision = note.revision + 1
    note.updated_at = now()


def patch(kind, path):
    content = json.load(open(path))
    _, maker = database(Settings.env())
    with maker() as d:
        item = remap(content[kind], content, here(d))
        runs = d.scalars(
            select(AgentRun)
            .where(AgentRun.status.in_(["queued", "running"]))
            .order_by(AgentRun.created_at.desc())
        ).all()
        match = None
        for run in runs:
            runtime = run.runtime or {}
            if runtime.get("reading_artifact_id"):
                continue
            if matches(kind, item, run, runtime.get("reader_context") or {}):
                match = run
                break
        if not match:
            raise SystemExit(f"no queued {kind} run to complete")
        match.status, match.response, match.error = "completed", item["response"], ""
        match.steps = item.get("steps", [])
        match.runtime = {
            **(match.runtime or {}),
            "settled": True,
            "phase": "completed",
            "execution_seconds": item["seconds"],
        }
        match.updated_at = now()
        if kind == "organize":
            note = next(step["receipt"]["entity_id"] for step in match.steps if step.get("receipt"))
            append_to_note(d, note, item["appended"])
        d.commit()
        print("completed", kind, match.id)


def layout(pdf_path):
    """The real Chinese PDF that layout translation produced, as a finished translation job."""
    import hashlib

    from backend.models import File, TranslationJob
    from backend.storage_budget import write_blob

    c = client()
    paper, source = amem(c)
    settings = Settings.env()
    _, maker = database(settings)
    raw = open(pdf_path, "rb").read()
    with maker() as d:
        if d.scalar(select(TranslationJob).where(TranslationJob.paper_id == paper["id"], TranslationJob.status == "completed")):
            print("layout translation already there")
            return
        from pypdf import PdfReader

        pages = len(PdfReader(pdf_path).pages)
        owner = d.get(File, source["id"]).owner
        translated = File(
            owner=owner, paper_id=paper["id"], version_id=source["version_id"],
            name=f"zh-{AMEM}v11.pdf", source_path=f"zh-{AMEM}v11.pdf", mime="application/pdf",
            pages=pages, size=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
        )
        d.add(translated)
        d.flush()
        write_blob(settings, translated.id, raw)
        d.add(TranslationJob(
            owner=owner, paper_id=paper["id"], version_id=source["version_id"], arxiv_id=f"{AMEM}v11",
            engine="latex", status="completed", stage="翻译完成", completed=106, total=106,
            source_file=source["id"], translated_file=translated.id,
            model="MiniMax-M3.1-Flash-Preview", model_config_id="platform-minimax",
            base_url="https://api.example.com/v1", protocol="openai",
            model_options={"thinking_mode": "default", "reasoning_effort": "low"},
        ))
        d.commit()
        print("layout translation added:", pages, "pages")


if __name__ == "__main__":
    if sys.argv[1] == "artifacts":
        artifacts(sys.argv[2])
    elif sys.argv[1] == "patch":
        patch(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "layout":
        layout(sys.argv[2])
