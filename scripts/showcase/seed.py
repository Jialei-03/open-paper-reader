#!/usr/bin/env python
"""Build the demo workspace that the homepage screenshots are taken from.

A throwaway backend (its own database and storage), one demo account, a small
library of well-known public arXiv papers, and a reading note. Nothing here is
invented about the product: papers are imported through the real arXiv import,
and the model outputs shown on the homepage are real ones (see fill_ai.py).

  DATABASE_URL=sqlite:////tmp/zhijian-demo/platform.db STORAGE_DIR=/tmp/zhijian-demo/files \\
  PLATFORM_MODEL_CONFIG=/tmp/zhijian-demo/platform-model.json \\
    uvicorn backend.main:app --port 8791    # then
  python scripts/showcase/seed.py http://127.0.0.1:8791
"""

import json
import sys
import time
import uuid
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from demo_env import demo_password  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791") + "/api/v1"
USER = {"username": "linyu", "password": demo_password()}
PAPERS = [
    # arXiv id, reading status, favorite, tags
    ("2502.12110", "reading", True, ["智能体记忆"]),
    ("2504.19413", "reading", True, ["智能体记忆"]),
    ("2310.08560", "read", False, ["智能体记忆"]),
    ("2210.03629", "read", True, ["推理与规划"]),
    ("2201.11903", "read", False, ["推理与规划"]),
    ("2303.11366", "unread", False, ["推理与规划"]),
    ("2005.11401", "read", False, ["检索增强"]),
    ("1706.03762", "read", True, ["基础模型"]),
]


def main():
    c = httpx.Client(base_url=BASE, timeout=120)
    c.post("/auth/register", json=USER)
    login = c.post("/auth/login", json=USER)
    assert login.status_code == 200, login.text
    csrf = login.json()["csrf"]
    c.headers["X-CSRF-Token"] = csrf

    def write(method, path, body=None):
        return c.request(
            method, path, json=body, headers={"Idempotency-Key": str(uuid.uuid4())}
        )

    have = {p["external_id"] for p in c.get("/papers").json()}
    for arxiv, status, favorite, tags in PAPERS:
        if f"arxiv:{arxiv}" in have or any(arxiv in e for e in have):
            continue
        r = write("POST", "/import/arxiv", {"url": f"https://arxiv.org/abs/{arxiv}"})
        if r.status_code != 200:
            print("import failed", arxiv, r.status_code, r.text[:200])
            continue
        paper = r.json()
        print("imported", arxiv, paper["title"][:60])
        time.sleep(1)
    import re

    papers = {
        re.sub(r"v\d+$", "", p["external_id"].replace("arxiv:", "")): p
        for p in c.get("/papers").json()
    }
    for arxiv, status, favorite, tags in PAPERS:
        paper = papers.get(arxiv)
        if not paper:
            print("missing", arxiv)
            continue
        r = c.request(
            "PATCH",
            f"/papers/{paper['id']}",
            json={"tags": tags, "favorite": favorite},
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(paper["revision"])},
        )
        if r.status_code != 200:
            print("update", arxiv, r.status_code, r.text[:160])
            continue
        paper = r.json()
        if status != "unread":
            r = c.request(
                "POST",
                f"/papers/{paper['id']}/events",
                json={"kind": "reading", "body": {"reading": "开始阅读", "read": "读完"}[status], "reading_status": status},
                headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(paper["revision"])},
            )
            if r.status_code != 200:
                print("status", arxiv, r.status_code, r.text[:160])
    notes(c, write, papers)
    extras(c, write, papers)
    print(json.dumps({k: v["id"] for k, v in papers.items()}))


def link(papers, arxiv, label=None):
    p = papers[arxiv]
    return f"[{label or p['title'].split(':')[0]}](#paper/{p['id']})"


def notes(c, write, papers):
    """A reading note for the main demo paper and short ones that link the papers together."""
    bodies = {
        "2502.12110": (
            "A-MEM 阅读笔记",
            "## 一句话\n"
            "A-MEM 把 **Zettelkasten 卡片盒笔记法** 搬进智能体记忆：每条记忆是一张“原子笔记”，"
            "由模型自己生成上下文、建立链接，并随新信息更新旧笔记。\n\n"
            "## 方法脉络\n"
            "1. **笔记构造**：原文、时间戳、关键词、标签、上下文描述，再编码成向量。\n"
            "2. **链接生成**：新笔记写入时先检索近邻，再由模型判断是否建立连接。\n"
            "3. **记忆演化**：新记忆可以改写旧记忆的上下文与标签，网络越用越密。\n\n"
            "> Our approach draws inspiration from the Zettelkasten method … atomic notes and flexible linking mechanisms.\n\n"
            "## 和其他工作的关系\n"
            f"- 对照 {link(papers, '2310.08560')}：MemGPT 靠类缓存的分层与换页，结构是预先设计的；A-MEM 的结构是写入时生成的。\n"
            f"- 对照 {link(papers, '2504.19413')}：同样关注长期记忆，Mem0 更强调生产环境的抽取与更新流程。\n"
            f"- 推理侧的背景见 {link(papers, '2210.03629')}。\n\n"
            "## 读的时候想到的问题\n"
            "- [ ] 每次写入都要调用模型判断链接，长对话下延迟与成本如何？\n"
            "- [ ] 和图数据库方案相比，“演化”到底带来多少收益？\n"
            "- [ ] 结果集中在 LoCoMo 与 DialSim，能否推广到别的任务？\n",
        ),
        "2504.19413": (
            "Mem0 阅读笔记",
            "## 要点\n"
            "Mem0 把长期记忆拆成 **抽取 → 更新 → 检索** 三步，面向生产环境，重点是延迟与成本。\n\n"
            f"与 {link(papers, '2502.12110')} 对读：Mem0 的流程是工程化的固定管线，A-MEM 让模型自己决定链接。\n"
            f"基线之一是 {link(papers, '2310.08560')}。\n",
        ),
        "2310.08560": (
            "MemGPT 阅读笔记",
            "## 要点\n把上下文窗口当作“主存”，外部存储当作“磁盘”，由模型发起换入换出。\n\n"
            f"后续工作 {link(papers, '2502.12110')} 与 {link(papers, '2504.19413')} 都把它当作主要基线。\n",
        ),
        "2210.03629": (
            "ReAct 阅读笔记",
            "## 要点\n推理与行动交替进行：先想，再调用工具，再根据观察继续想。\n\n"
            f"和 {link(papers, '2201.11903')}（思维链）一起，是后来智能体方法的基础；"
            f"记忆方面的延伸见 {link(papers, '2502.12110')}。\n",
        ),
        "1706.03762": (
            "Transformer 阅读笔记",
            "## 要点\n只用注意力，不用循环和卷积：编码器、解码器各自堆叠 6 层，核心是 **缩放点积注意力** 与多头。\n\n"
            "## 值得记住\n"
            "- 位置编码用正弦函数，让模型知道词的先后。\n"
            "- 并行度高，训练时间比循环网络短得多。\n\n"
            f"后续几乎所有大模型工作的基础，例如 {link(papers, '2005.11401')} 的生成器就是 Transformer。\n",
        ),
        "2201.11903": (
            "思维链阅读笔记",
            "## 要点\n在提示里给出 **一步一步的推理示例**，足够大的模型就会自己写出推理过程，算术与常识推理明显提升。\n\n"
            f"和 {link(papers, '2210.03629')}（ReAct）的区别：思维链只想不做，ReAct 把想和行动交替起来。\n",
        ),
        "2005.11401": (
            "RAG 阅读笔记",
            "## 要点\n把 **检索器** 和 **生成器** 接起来：先从外部语料取回相关段落，再让模型据此作答。\n\n"
            f"和 {link(papers, '2504.19413')} 对读：RAG 检索的是文档，Mem0 检索的是对话里抽取出的记忆。\n",
        ),
        "2303.11366": (
            "Reflexion 阅读笔记",
            "## 要点\n不改权重：失败之后让模型写一段 **语言反思**，存进记忆，下一次尝试时读取。\n\n"
            f"它的“记忆”是一段反思文字；{link(papers, '2502.12110')} 把记忆做成可链接、可演化的笔记网络。\n",
        ),
    }
    for arxiv, (title, body) in bodies.items():
        paper = papers[arxiv]
        found = [i for i in c.get("/items", params={"paper_id": paper["id"]}).json() if i["kind"] == "note"]
        if not found:
            print("no note for", arxiv)
            continue
        note = found[0]
        r = c.request(
            "PUT",
            f"/items/{note['id']}",
            json={"kind": "note", "paper_id": paper["id"], "title": title, "body": body, "tags": note.get("tags", [])},
            headers={"Idempotency-Key": str(uuid.uuid4()), "If-Match": str(note["revision"])},
        )
        if r.status_code != 200:
            print("note", arxiv, r.status_code, r.text[:200])


def extras(c, write, papers):
    """Topics, questions, a comparison and its evidence: the pieces that make the
    knowledge graph more than a list of papers. Each links to papers (关联论文),
    to other records (引用证据) and in its text (正文链接)."""
    have = {i["title"] for i in c.get("/items").json()}
    ids = {k: v["id"] for k, v in papers.items()}
    a, mem0, memgpt = ids["2502.12110"], ids["2504.19413"], ids["2310.08560"]
    react, cot, reflexion = ids["2210.03629"], ids["2201.11903"], ids["2303.11366"]
    rag = ids["2005.11401"]

    def locate(paper_id, page, quote, label):
        """Evidence points at the words it rests on, as the reader's own 摘录 does."""
        pdf = next(f for f in c.get(f"/papers/{paper_id}/files").json() if f["mime"] == "application/pdf")
        return {"version_id": pdf["version_id"], "file_id": pdf["id"], "page": page, "quote": quote, "label": label}

    def make(kind, title, body, paper_ids=(), evidence_ids=(), paper_id=None, locator=None):
        if title in have:
            return next(i["id"] for i in c.get("/items").json() if i["title"] == title)
        fields = {"paper_id": paper_id} if paper_id else {}
        if locator:
            fields["locator"] = locator
        r = write(
            "POST",
            "/items",
            {"kind": kind, "title": title, "body": body, "paper_ids": list(paper_ids), "evidence_ids": list(evidence_ids), **fields},
        )
        if r.status_code != 200:
            print("item", title, r.status_code, r.text[:200])
            return None
        return r.json()["id"]

    memory = make(
        "topic",
        "智能体长期记忆",
        "围绕 **写入、链接、演化、检索** 四件事的一组工作：谁来决定记什么，记忆之间怎样互相联系。",
        [a, mem0, memgpt],
    )
    make(
        "topic",
        "推理与行动",
        "让模型先想、再做、再根据结果修正：思维链、ReAct 与 Reflexion 是同一条线上的三步。",
        [react, cot, reflexion],
    )
    make("topic", "检索增强生成", "把外部知识放进上下文，而不是都塞进参数里。", [rag, mem0])
    evidence = make(
        "evidence",
        "A-MEM 在 LoCoMo 上的多跳问答结果",
        "论文表 1：五类问答（多跳、时间、开放域、单跳、对抗）在六个基座模型上的 F1 与 BLEU-1。读的时候回到第 6 页核对多跳一栏的数字。",
        [a],
        paper_id=a,
        locator=locate(a, 6, "Experimental results on LoCoMo dataset of QA tasks across five categories", "表 1"),
    )
    make(
        "evidence",
        "Reflexion 用语言反馈取代梯度更新",
        "失败后让模型写一段反思，存入记忆，下一次尝试时读取：不改权重，只改上下文。",
        [reflexion],
        paper_id=reflexion,
        locator=locate(reflexion, 1, "Reflexion agents verbally reflect on task feedback signals", "摘要"),
    )
    make(
        "analysis",
        "记忆写入：固定管线与模型自主决定",
        "MemGPT 的分层与换页、Mem0 的抽取与更新，都是事先设计好的流程；A-MEM 在写入时由模型生成上下文并决定链接。"
        f"归入主题 [智能体长期记忆](#item/{memory})。",
        [a, mem0, memgpt],
        [evidence] if evidence else [],
        paper_id=a,
    )
    make(
        "question",
        "记忆演化会不会放大早期错误？",
        f"A-MEM 允许新记忆改写旧记忆的标签与上下文。早期判断有误时，错误会沿着链接传播吗？属于 [智能体长期记忆](#item/{memory})。",
        [a, mem0],
        paper_id=a,
    )
    make(
        "question",
        "写入时调用模型，延迟与成本的上限在哪里？",
        f"每条新记忆都要经过链接判断。对话变长后需要看实验里的延迟数据。属于 [智能体长期记忆](#item/{memory})。",
        [a, memgpt],
        paper_id=a,
    )
    make(
        "note",
        "记忆方向的阅读顺序",
        f"先读 {link(papers, '2310.08560')}，再读 {link(papers, '2504.19413')}，最后读 {link(papers, '2502.12110')}；"
        f"推理侧的背景看 {link(papers, '2210.03629')}。",
    )


if __name__ == "__main__":
    main()
