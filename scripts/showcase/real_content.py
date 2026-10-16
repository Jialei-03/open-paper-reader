#!/usr/bin/env python
"""Real model outputs for the homepage's demo scenes (run where the model key is).

Runs a few reader actions on a public paper with the platform model, exactly as
the reader does, and writes what the model answered, together with the reading
results already produced for that paper in the scratch database, to one JSON
file that scripts/showcase/fill_ai.py loads into the demo workspace.
"""

import json
import os
import re
import sqlite3
import sys
import uuid

sys.path.insert(0, os.getcwd())
from scripts.bench_model import Bench  # noqa: E402

ARXIV = "2502.12110v11"
ZETTEL = (
    "Our approach draws inspiration from the Zettelkasten method [ 15, 1], a "
    "sophisticated knowledge management system that creates interconnected "
    "information networks through atomic notes and flexible linking mechanisms."
)
FIGURE_RECT = [0.17, 0.083, 0.66, 0.131]
FORMULA_RECT = [0.40, 0.570, 0.26, 0.056]  # equation (4), the similarity score, on page 4
TABLE_RECT = [0.172, 0.098, 0.655, 0.0765]  # Table 2 and its caption, on page 7
QUESTION = "A-MEM 和 MemGPT 在记忆的组织方式上有什么不同？"
# The three papers the library's 比较论文 button compares in the demo, in the
# order the library lists them, with the titles arXiv gives them.
COMPARED = [
    ("2310.08560", "MemGPT: Towards LLMs as Operating Systems"),
    ("2504.19413", "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory"),
    ("2502.12110", "A-MEM: Agentic Memory for LLM Agents"),
]
# How each scene's run is found again in the scratch database.
ORGANIZE = (
    "请读一下 MemGPT、Mem0 和 A-MEM 三篇论文，把它们在「记忆怎么写入、怎么组织」上的差异整理成一小节对照笔记，"
    "追加到《A-MEM 阅读笔记》末尾，并链接到另外两篇论文。"
)
PROMPTS = {
    "explain": "请结合论文上下文解释所选文字",
    "figure": "请结合论文上下文解释所选区域",
    "chat": QUESTION,
    "formula": "请只解释框选区域中的公式",
    "organize": ORGANIZE,
}


def clean(steps):
    """What the interface shows of a step: what was done and how it ended. The
    long result texts and internal fingerprints stay behind."""
    return [
        {k: step[k] for k in ("name", "label", "status", "arguments", "receipt") if k in step}
        for step in steps
    ]


def steps_of(bench, prompt):
    from sqlalchemy import select

    from backend.models import AgentRun

    with bench.app.state.maker() as d:
        run = d.scalars(
            select(AgentRun)
            .where(AgentRun.prompt.like(prompt + "%"), AgentRun.status == "completed")
            .order_by(AgentRun.created_at.desc())
        ).first()
        return clean(run.steps) if run else []


def add_paper(bench, arxiv, title):
    """Another arXiv paper in the scratch library, under its real title."""
    from backend.arxiv_import import download

    for paper in bench.client.get("/api/v1/papers").json():
        if paper["external_id"].removeprefix("arxiv:").startswith(arxiv):
            return paper, bench.client.get(f"/api/v1/papers/{paper['id']}/files").json()[0]
    raw = download("/pdf/" + arxiv)
    paper = bench.write("POST", "/papers", {"title": title, "external_id": "arxiv:" + arxiv}).json()
    uploaded = bench.client.post(
        f"/api/v1/papers/{paper['id']}/files",
        data={"version_id": paper["current_version"]},
        files={"file": (f"{arxiv}.pdf", raw, "application/pdf")},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert uploaded.status_code == 200, uploaded.text
    return paper, uploaded.json()


def retitle(bench, paper, title):
    revision = bench.client.get(f"/api/v1/papers/{paper['id']}").json()["revision"]
    changed = bench.client.request(
        "PATCH",
        f"/api/v1/papers/{paper['id']}",
        json={"title": title},
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(revision)},
    )
    assert changed.status_code == 200, changed.text


def run(bench, model, prompt, context=None):
    session = bench.write("POST", "/agent/sessions", {}).json()["id"]
    body = {"prompt": prompt, "model_config_id": model["id"]}
    if context:
        body["reader_context"] = context
    made = bench.write("POST", f"/agent/sessions/{session}/runs", body)
    assert made.status_code == 200, made.text
    run_id = made.json()["id"]
    seconds, _ = bench.execute(run_id)
    done = bench.run_of(run_id)
    assert done["status"] == "completed", done
    return {"seconds": round(seconds, 1), "response": done["response"], "steps": steps_of(bench, prompt)}


def organize(bench, model):
    """Ask the assistant to read three papers and write what it found into the
    A-MEM note, which it may do because library changes are allowed. The note
    starts as it is in the demo (title and opening); what the assistant adds to
    it is exported so the demo's own note can be given the same ending."""
    for arxiv, title in COMPARED:
        if arxiv != ARXIV.split("v")[0]:
            add_paper(bench, arxiv, title)
    retitle(bench, bench.paper, COMPARED[2][1])
    note = next(i for i in bench.client.get("/api/v1/items", params={"paper_id": bench.paper["id"]}).json() if i["kind"] == "note")
    opening = (
        "## 一句话\n"
        "A-MEM 把 **Zettelkasten 卡片盒笔记法** 搬进智能体记忆：每条记忆是一张“原子笔记”，"
        "由模型自己生成上下文、建立链接，并随新信息更新旧笔记。\n"
    )
    saved = bench.client.request(
        "PUT",
        f"/api/v1/items/{note['id']}",
        json={"kind": "note", "paper_id": bench.paper["id"], "title": "A-MEM 阅读笔记", "body": opening, "tags": note.get("tags", [])},
        headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(note["revision"])},
    )
    assert saved.status_code == 200, saved.text
    result = run(bench, model, ORGANIZE)
    final = bench.client.get(f"/api/v1/items/{note['id']}").json()["body"]
    assert final.startswith(opening) and len(final) > len(opening), "the assistant did not simply append to the note"
    ids = {}
    for arxiv, title in COMPARED:
        for paper in bench.client.get("/api/v1/papers").json():
            if paper["external_id"].removeprefix("arxiv:").startswith(arxiv):
                files = bench.client.get(f"/api/v1/papers/{paper['id']}/files").json()
                ids[arxiv] = {"paper": paper["id"], "file": files[0]["id"], "note": note["id"] if arxiv == ARXIV.split("v")[0] else ""}
    return {"prompt": ORGANIZE, "appended": final[len(opening):], "ids": ids, **result}


def compare(bench, model):
    """The prompt is the one the library's 比较论文 button writes (see
    frontend/src/components/PaperBatchActions.tsx)."""
    papers = []
    for arxiv, title in COMPARED:
        if arxiv == ARXIV.split("v")[0]:
            retitle(bench, bench.paper, title)
            papers.append((arxiv, bench.paper, bench.file))
        else:
            paper, file = add_paper(bench, arxiv, title)
            papers.append((arxiv, paper, file))
    prompt = (
        f"请实际读取以下 {len(papers)} 篇论文并比较研究问题、方法、数据与实验结果、各自局限。"
        "用表格整理差异，每项结论链接到具体论文和证据页；读取失败或证据不足请明确说明，不要自动创建笔记。\n\n"
        + "\n".join(f"- {title}（论文 ID：{paper['id']}）" for (_, paper, _), (_, title) in zip(papers, COMPARED))
    )
    result = run(bench, model, prompt)
    result["steps"] = steps_of(bench, prompt[:40])
    return {
        "titles": [title for _, title in COMPARED],
        "ids": {arxiv: {"paper": paper["id"], "file": file["id"]} for arxiv, paper, file in papers},
        **result,
    }


SCENES = ["explain", "figure", "chat", "formula", "translate", "table", "compare", "organize"]


def main():
    out = sys.argv[1]
    only = [a for a in sys.argv[2:] if not a.startswith("-")] or SCENES
    bench = Bench(os.environ["BENCH_DIR"], ARXIV)
    model = bench.model("platform-minimax")
    base = {"paper_id": bench.paper["id"], "file_id": bench.file["id"]}
    page2 = " ".join(bench.page_text(2).split())
    assert ZETTEL in page2, "the sentence is not on page 2 as written"
    before = page2[: page2.index(ZETTEL)][-400:]
    # Scenes already collected are kept when only some are asked for again.
    items = json.load(open(out)) if os.path.exists(out) else {}
    scenes = {
        "explain": lambda: {
            "page": 2,
            "quote": ZETTEL,
            **run(
                bench,
                model,
                "请结合论文上下文解释所选文字，说明概念、论证及其局限，并给出原文依据。",
                {**base, "page": 2, "source": "selection", "action": "explain", "quote": ZETTEL},
            ),
        },
        "figure": lambda: {
            "page": 2,
            "rect": FIGURE_RECT,
            **run(
                bench,
                model,
                "请结合论文上下文解释所选区域，说明图表在表达什么。",
                {**base, "page": 2, "source": "region", "action": "explain", "rect": FIGURE_RECT},
            ),
        },
        "chat": lambda: {
            "question": QUESTION,
            **run(bench, model, QUESTION, {**base, "page": 1, "source": "paper", "action": "ask"}),
        },
        # The prompts below are the reader's own (frontend/src/lib/reader-agent.ts).
        "formula": lambda: {
            "page": 4,
            "rect": FORMULA_RECT,
            **run(
                bench,
                model,
                "请只解释框选区域中的公式：准确转写公式，说明符号定义、假设及推导含义，并结合相邻上下文说明用途。不能辨认的符号请明确说明，不要猜测，也不要扩展为整页导读。",
                {**base, "page": 4, "source": "region", "action": "formula", "rect": FORMULA_RECT},
            ),
        },
        "translate": lambda: {
            "page": 2,
            "quote": ZETTEL,
            **run(
                bench,
                model,
                "请将所选文字翻译成中文，保留公式、术语和引用编号。只翻译这段内容，不自动新建笔记。",
                {**base, "page": 2, "source": "selection", "action": "translate", "quote": ZETTEL, "prefix": before},
            ),
        },
        "table": lambda: {
            "page": 7,
            "rect": TABLE_RECT,
            **run(
                bench,
                model,
                "请读取所选区域并翻译成中文，保留段落结构、公式、术语和引用编号。只翻译所选区域，不要扩展到其他页，不自动新建笔记。",
                {**base, "page": 7, "source": "region", "action": "translate", "rect": TABLE_RECT},
            ),
        },
    }
    scenes["compare"] = lambda: compare(bench, model)
    scenes["organize"] = lambda: organize(bench, model)
    for name in only:
        items[name] = scenes[name]()
    # What the earlier answers did (which pages they read) is stored with the run.
    for name, prompt in PROMPTS.items():
        if name in items:
            items[name]["steps"] = items[name].get("steps") or steps_of(bench, prompt)
    items["ids"] = {
        ARXIV.split("v")[0]: {"paper": bench.paper["id"], "file": bench.file["id"], "note": ""},
        **items.get("compare", {}).get("ids", {}),
    }
    for number, ids in items.get("organize", {}).get("ids", {}).items():
        items["ids"][number] = {**items["ids"].get(number, {}), **{k: v for k, v in ids.items() if v}}
    # What the scratch database already holds for this paper.
    db = sqlite3.connect(os.path.join(os.environ["BENCH_DIR"], "bench.db"))
    artifacts = []
    for kind, parameters, result, evidence, options in db.execute(
        "select kind, parameters, result, evidence_pages, model_options from reading_artifacts where status = 'completed'"
    ):
        artifacts.append(
            {
                "kind": kind,
                "parameters": json.loads(parameters),
                "result": json.loads(result),
                "evidence_pages": json.loads(evidence),
                "options": json.loads(options),
            }
        )
    items["artifacts"] = artifacts
    json.dump(items, open(out, "w"), ensure_ascii=False, indent=1)
    print({k: (v.get("seconds") if isinstance(v, dict) else len(v)) for k, v in items.items()})


if __name__ == "__main__":
    main()
