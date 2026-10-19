"""What may stand behind a research result: real log lines, or real sentences.

A log line must come from a finished job's output as the system collected it.
A sentence must be found on the page of the paper it is cited from. Every
number a result states (other than small counts) must appear in what it cites.
"""

import re

from sqlalchemy import select

from .citation_marks import check_quote
from .models import File, ResearchJob
from .research_sandbox import read_log

NUMBER = re.compile(r"-?\d+(?:\.\d+)?%?")
MAX_LINES = 50
KEPT_LINES = 20


def pages_of(app, owner, file_id):
    """{page number: text} of a PDF the owner has."""
    from .agent_reading import page_texts, pdf_file

    file = pdf_file(app, owner, file_id)
    return {n + 1: text for n, text in enumerate(page_texts(app, file))}


def _numbers(text):
    # One- to three-digit whole numbers are mostly counts and seeds ("3 个种子").
    return [n for n in NUMBER.findall(text or "") if not re.fullmatch(r"-?\d{1,3}", n)]


def _value(token):
    percent = token.endswith("%")
    try:
        return float(token.rstrip("%")), percent
    except ValueError:
        return None, percent


def _appears(number, text):
    """The same value is in the text: 0.674 is 0.6740, but 0.873 is not 0.8731."""
    want = _value(number)
    return any(_value(token) == want for token in NUMBER.findall(text or ""))


def _job(d, project, job_id):
    """A job of this project, named by its id or (as models do) its first characters."""
    job = d.get(ResearchJob, job_id)
    if job is not None or len(job_id or "") < 8:
        return job
    found = [
        j
        for j in d.scalars(
            select(ResearchJob).where(ResearchJob.project_id == project.id)
        )
        if j.id.startswith(job_id[:8])
    ]
    return found[0] if len(found) == 1 else None


def check(app, d, owner, project, summary, evidence, stated=""):
    """The evidence, checked and with what it points to; raises ValueError naming the problem."""
    if not evidence:
        raise ValueError("结果必须附上证据：作业日志的行，或文献中的原句")
    settings = app.state.settings
    checked, texts = [], []
    for n, item in enumerate(evidence, 1):
        kind = item.get("kind")
        if kind == "log":
            job = _job(d, project, item.get("job_id", ""))
            if job is None or job.project_id != project.id:
                raise ValueError(f"第 {n} 条证据：作业不属于这个研究项目")
            if job.status == "running":
                raise ValueError(f"第 {n} 条证据：作业还没有结束，等它结束再引用结果")
            start, end = item.get("from_line", 0), item.get("to_line", 0)
            if not (1 <= start <= end <= job.log_lines) or end - start >= MAX_LINES:
                raise ValueError(
                    f"第 {n} 条证据：行号不在日志范围内（共 {job.log_lines} 行，"
                    f"一次最多引用 {MAX_LINES} 行）"
                )
            lines = [
                row["text"]
                for row in read_log(settings, job, start - 1, end - start + 1)["lines"]
            ]
            texts.extend(lines)
            checked.append(
                {
                    "kind": "log",
                    "job_id": job.id,
                    "from_line": start,
                    "to_line": end,
                    "lines": lines[:KEPT_LINES],
                }
            )
        elif kind == "cite":
            pages = pages_of(app, owner, item.get("file_id", ""))
            found = check_quote(item.get("page", 0), item.get("quote", ""), pages)
            if not found:
                raise ValueError(f"第 {n} 条证据：在论文原文中找不到这句话")
            page, quote = found
            texts.append(quote)
            file = d.get(File, item["file_id"])
            checked.append(
                {
                    "kind": "cite",
                    "file_id": item["file_id"],
                    # So the page can open the sentence in the reader.
                    "paper_id": file.paper_id if file is not None else None,
                    "page": page,
                    "quote": quote,
                }
            )
        else:
            raise ValueError(f"第 {n} 条证据：类型只能是 log 或 cite")
    cited = "\n".join(texts)
    # A number the question, the background or the kill condition already states
    # (a split size, a threshold) is a setting, not a result.
    missing = [
        n
        for n in _numbers(summary)
        if not _appears(n, cited) and not _appears(n, stated)
    ]
    if missing:
        raise ValueError(
            "结果中的数字在所引证据里找不到："
            + "、".join(dict.fromkeys(missing))
            + "。数字必须逐字出现在引用的日志行或原文里；均值等派生数字请先用脚本算出并打印到作业日志"
        )
    return checked
