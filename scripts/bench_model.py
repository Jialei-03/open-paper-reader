#!/usr/bin/env python
"""Time the model-backed features of a release against a real model.

Everything runs in a scratch database and storage directory (BENCH_DIR), never
the real ones: a bench account, a real arXiv paper, and the same code paths the
product uses (the API, the agent worker as a child process, the translation
engine). The model comes from PLATFORM_MODEL_CONFIG, the same file the product
reads for its shared model (locally: data/platform-model.json, written by
scripts/set-local-model.sh). Keys are never printed. See docs/PERFORMANCE.md.

  PLATFORM_MODEL_CONFIG=data/platform-model.json BENCH_DIR=/tmp/paper-bench \\
    python scripts/bench_model.py pages --pages 1,2 --model platform-minimax

Scenarios: pages, selection, region, guide, quiz, outline, highlights, latex,
figures, probe. Results are printed and appended to BENCH_DIR/results.jsonl.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))



def bench_password(directory):
    """A password for the scratch account: BENCH_PASSWORD, or one derived from the
    scratch directory (the account only exists inside that throwaway database)."""
    import hashlib

    return os.environ.get("BENCH_PASSWORD") or "bench-" + hashlib.sha256(
        str(Path(directory).resolve()).encode()
    ).hexdigest()[:24]


class Bench:
    def __init__(self, directory, arxiv, pdf=None):
        from fastapi.testclient import TestClient

        from backend.config import Settings
        from backend.main import PASSWORD, create_app
        from backend.models import Base, User

        self.dir = Path(directory)
        self.password = bench_password(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.database = f"sqlite:///{self.dir / 'bench.db'}"
        self.storage = str(self.dir / "files")
        settings = Settings(database_url=self.database, storage=self.storage)
        self.app = create_app(settings)
        Base.metadata.create_all(self.app.state.engine)
        with self.app.state.maker() as d:
            if not d.query(User).filter(User.username == "bench").first():
                d.add(
                    User(
                        username="bench",
                        email="bench@example.test",
                        password=PASSWORD.hash(self.password),
                        admin=False,
                    )
                )
                d.commit()
        self.client = TestClient(self.app)
        login = self.client.post(
            "/api/v1/auth/login",
            json={"username": "bench", "password": self.password},
        )
        assert login.status_code == 200, login.text
        self.client.headers["X-CSRF-Token"] = login.json()["csrf"]
        self.owner = self.client.get("/api/v1/auth/me").json()["user"]["id"]
        self.settings = settings
        self.paper, self.file = self.paper_with_pdf(arxiv, pdf)

    def write(self, method, path, body=None, **kwargs):
        return self.client.request(
            method,
            "/api/v1" + path,
            json=body,
            headers={"Idempotency-Key": str(uuid.uuid4())},
            **kwargs,
        )

    def paper_with_pdf(self, arxiv, pdf):
        existing = self.client.get("/api/v1/papers").json()
        for paper in existing:
            if paper["external_id"] == "arxiv:" + arxiv:
                files = self.client.get(f"/api/v1/papers/{paper['id']}/files").json()
                return paper, files[0]
        if pdf:
            raw = Path(pdf).read_bytes()
        else:
            from backend.arxiv_import import download

            raw = download("/pdf/" + arxiv)
        paper = self.write(
            "POST", "/papers", {"title": f"bench {arxiv}", "external_id": "arxiv:" + arxiv}
        ).json()
        uploaded = self.client.post(
            f"/api/v1/papers/{paper['id']}/files",
            data={"version_id": paper["current_version"]},
            files={"file": (f"{arxiv}.pdf", raw, "application/pdf")},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert uploaded.status_code == 200, uploaded.text
        return paper, uploaded.json()

    def model(self, wanted):
        models = self.client.get("/api/v1/translation-settings").json()["models"]
        choice = next((m for m in models if m["id"] == wanted), None) or next(
            (m for m in models if m["model"] == wanted), None
        )
        if not choice:
            raise SystemExit(
                f"no such model {wanted!r}; have {[m['id'] for m in models]}"
            )
        return choice

    def set_options(self, model_id, mode="default", effort="default"):
        from backend.translation_settings import save_options

        save_options(
            self.settings,
            self.owner,
            model_id,
            {"thinking_mode": mode, "reasoning_effort": effort},
        )

    def usage(self, task_id):
        from backend.models import ModelUsage

        with self.app.state.maker() as d:
            rows = d.query(ModelUsage).filter(ModelUsage.task_id == task_id).all()
            return {
                "requests": len(rows),
                "input": sum(r.input_tokens or 0 for r in rows),
                "output": sum(r.output_tokens or 0 for r in rows),
                "known": sum(1 for r in rows if r.total_tokens is not None),
            }

    def execute(self, run_id):
        """Run one agent run the way the worker does: a child process."""
        from backend.models import AgentRun

        with self.app.state.maker() as d:
            d.get(AgentRun, run_id).status = "running"
            d.commit()
        env = {
            **os.environ,
            "DATABASE_URL": self.database,
            "STORAGE_DIR": self.storage,
            "PYTHONPATH": os.pathsep.join(filter(None, [str(ROOT), os.environ.get("PYTHONPATH")])),
        }
        started = time.monotonic()
        child = subprocess.run(
            [sys.executable, "-m", "backend.agent_worker", "--job", run_id],
            env=env,
            cwd=ROOT,
            capture_output=True,
            timeout=1200,
            check=False,
        )
        return time.monotonic() - started, child.returncode

    def run_of(self, run_id):
        from backend.models import AgentRun

        with self.app.state.maker() as d:
            r = d.get(AgentRun, run_id)
            return {"status": r.status, "error": r.error, "response": r.response}

    def artifact(self, model_id, kind, **params):
        body = {
            "file_id": self.file["id"],
            "model_config_id": model_id,
            "kind": kind,
            "regenerate": True,
            **params,
        }
        made = self.write("POST", f"/papers/{self.paper['id']}/reading-artifacts", body)
        assert made.status_code == 200, made.text
        return made.json()

    def timed_artifact(self, model_id, kind, **params):
        row = self.artifact(model_id, kind, **params)
        seconds, code = self.execute(row["run_id"])
        done = self.client.get(f"/api/v1/reading-artifacts/{row['id']}").json()
        result = done.get("result") or {}
        detail = {}
        if kind == "page_translation":
            paragraphs = result.get("paragraphs", [])
            detail = {
                "paragraphs": len(paragraphs),
                "chinese_chars": sum(len(p["translation"]) for p in paragraphs),
            }
        return {
            "seconds": round(seconds, 1),
            "status": done["status"],
            "error": done.get("error", "")[:120],
            "options": done.get("model_options"),
            "usage": self.usage(row["run_id"]),
            **detail,
        }

    def reader_run(self, model_id, action, source, **context):
        session = self.write("POST", "/agent/sessions", {}).json()["id"]
        payload = {
            "paper_id": self.paper["id"],
            "file_id": self.file["id"],
            "page": context.pop("page", 1),
            "source": source,
            "action": action,
            **context,
        }
        prompt = {
            "translate": "请将所选文字翻译成中文，保留公式、术语和引用编号。",
            "explain": "请结合论文上下文解释所选内容。",
        }[action]
        made = self.write(
            "POST",
            f"/agent/sessions/{session}/runs",
            {"prompt": prompt, "model_config_id": model_id, "reader_context": payload},
        )
        assert made.status_code == 200, made.text
        run = made.json()
        seconds, code = self.execute(run["id"])
        done = self.run_of(run["id"])
        return {
            "seconds": round(seconds, 1),
            "status": done["status"],
            "error": done["error"][:120],
            "chars": len(done["response"]),
            "options": run["runtime"].get("model_options"),
            "direct": bool(run["runtime"].get("direct")),
            "usage": self.usage(run["id"]),
        }

    def page_text(self, page):
        from pypdf import PdfReader

        path = Path(self.storage) / self.file["id"]
        return PdfReader(path).pages[page - 1].extract_text() or ""


def latex(bench, model, args, tag):
    """Layout translation of the paper's arXiv source: model phase, then compile phase."""
    import shutil
    import tempfile

    from backend.arxiv_import import download, extract_source
    from backend.model_usage import bind
    from backend.translation_engine import compile_project, translate_project
    from backend.translation_settings import read_config

    work = Path(tempfile.mkdtemp(prefix="latex-", dir=args.dir))
    raw = download("/src/" + args.arxiv)
    extract_source(raw, work / "source")
    for label, mode, effort in variants(bench, model, args):
        bench.set_options(model["id"], mode, effort)
        config = read_config(bench.settings, bench.owner, model["id"])
        # A layout job carries the strength its task uses (the fast one), unless
        # this run is comparing settings by overriding it with --fast.
        from backend.model_options import task_options

        config = {**config, **task_options(config, "translate")}
        marker = f"latex-{uuid.uuid4().hex[:8]}"
        config = bind(config, bench.app.state.maker, bench.settings, bench.owner, "translation", marker)
        progress_log = []
        started = time.monotonic()
        error = ""

        def progress(done, total, stage, cache=None):
            progress_log.append((round(time.monotonic() - started, 1), done, total))
            if args.budget and time.monotonic() - started > args.budget:
                raise TimeoutError("budget")

        try:
            units = translate_project(
                work / "source",
                work / f"translated-{label.replace(':', '-')}",
                config,
                progress,
            )
        except Exception as e:  # noqa: BLE001 - report and continue
            units, error = [], ("time budget reached" if "budget" in str(e) else str(e)[:200])
        translated_at = time.monotonic() - started
        pdf_seconds = None
        compiled = False
        if units and not args.no_compile:
            begun = time.monotonic()
            try:
                built = compile_project(work / f"translated-{label.replace(':', '-')}")
                compiled = True
                shutil.copy(built, Path(args.dir) / f"latex-{label.replace(':', '-')}.pdf")
            except Exception as e:  # noqa: BLE001
                error = str(e)[:200]
            pdf_seconds = round(time.monotonic() - begun, 1)
        done_units = progress_log[-1][1] if progress_log else 0
        total_units = progress_log[-1][2] if progress_log else 0
        emit(args.dir, "latex", f"{tag} {label}", {
            "units": len(units),
            "done_units": done_units,
            "total_units": total_units,
            "units_per_minute": round(done_units / max(translated_at, 1) * 60, 1),
            "translate_seconds": round(translated_at, 1),
            "compile_seconds": pdf_seconds,
            "compiled": compiled,
            "error": error,
            "usage": bench.usage(marker),
            "batches_reported": len(progress_log),
        })
    shutil.rmtree(work, ignore_errors=True)


def emit(directory, scenario, label, result):
    line = {"scenario": scenario, "label": label, **result}
    print(json.dumps(line, ensure_ascii=False))
    with (Path(directory) / "results.jsonl").open("a") as out:
        out.write(json.dumps(line, ensure_ascii=False) + "\n")


def variants(bench, model, args):
    """The thinking settings to compare: what the reader has saved for the profile."""
    for label in args.efforts.split(","):
        mode, _, effort = label.partition(":")
        yield label, mode, effort or "default"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario")
    parser.add_argument("--dir", default=os.environ.get("BENCH_DIR", "/tmp/paper-bench"))
    parser.add_argument("--arxiv", default="2502.12110v11")
    parser.add_argument("--pdf")
    parser.add_argument("--model", default="platform-minimax")
    parser.add_argument("--pages", default="1")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument(
        "--efforts",
        default="default",
        help="profile settings to compare, as mode or mode:effort, e.g. default,default:low,adaptive:high",
    )
    parser.add_argument("--parallel", type=int, default=1)
    parser.add_argument(
        "--fast",
        help="override the strength that translation, outline and highlights use, as mode or mode:effort (new code only)",
    )
    parser.add_argument("--language", default="zh")
    parser.add_argument("--no-compile", action="store_true")
    parser.add_argument("--big-batches", action="store_true", help="give every MiniMax model the large batch size (new code only)")
    parser.add_argument("--budget", type=int, default=0, help="stop the model phase after this many seconds")
    args = parser.parse_args()

    if args.fast:
        from backend import model_options

        if hasattr(model_options, "LOWEST"):
            mode, _, effort = args.fast.partition(":")
            for name in model_options.LOWEST:
                model_options.LOWEST[name] = {
                    "thinking_mode": mode,
                    "reasoning_effort": effort or "default",
                }
    if args.big_batches:
        from backend import translation_engine

        translation_engine.BIG_BATCH = {"minimax-m3", "minimax-m3.1-flash-preview"}
    bench = Bench(args.dir, args.arxiv, args.pdf)
    model = bench.model(args.model)
    tag = f"{model['model']}"
    pages = [int(n) for n in args.pages.split(",")]

    if args.scenario == "pages":
        for label, mode, effort in variants(bench, model, args):
            bench.set_options(model["id"], mode, effort)
            for repeat in range(args.repeat):
                if args.parallel > 1:
                    # Pages go in groups of `parallel`, as the reader sends them:
                    # a few at once, never the whole paper.
                    started = time.monotonic()
                    outcomes = {}
                    for at in range(0, len(pages), args.parallel):
                        group, threads = pages[at : at + args.parallel], []

                        def one(page):
                            outcomes[page] = bench.timed_artifact(
                                model["id"], "page_translation", page=page, language=args.language
                            )

                        for page in group:
                            thread = threading.Thread(target=one, args=(page,))
                            thread.start()
                            threads.append(thread)
                        for thread in threads:
                            thread.join()
                    failed = {p: o["error"] for p, o in outcomes.items() if o["status"] != "completed"}
                    emit(args.dir, "pages-parallel", f"{tag} {label}", {
                        "wall": round(time.monotonic() - started, 1),
                        "pages": len(pages),
                        "failed": failed,
                        "median_seconds": sorted(o["seconds"] for o in outcomes.values())[len(outcomes) // 2],
                        "tokens_out": sum(o["usage"]["output"] for o in outcomes.values()),
                    })
                    continue
                for page in pages:
                    emit(args.dir, "pages", f"{tag} {label} p{page}", bench.timed_artifact(
                        model["id"], "page_translation", page=page, language=args.language
                    ))
    elif args.scenario == "selection":
        text = bench.page_text(pages[0])
        quote = " ".join(text.split())[:500]
        for label, mode, effort in variants(bench, model, args):
            bench.set_options(model["id"], mode, effort)
            for _ in range(args.repeat):
                emit(args.dir, "selection", f"{tag} {label}", bench.reader_run(
                    model["id"], "translate", "selection", page=pages[0], quote=quote
                ))
    elif args.scenario == "explain":
        text = bench.page_text(pages[0])
        quote = " ".join(text.split())[600:1100]
        for label, mode, effort in variants(bench, model, args):
            bench.set_options(model["id"], mode, effort)
            for _ in range(args.repeat):
                emit(args.dir, "explain", f"{tag} {label}", bench.reader_run(
                    model["id"], "explain", "selection", page=pages[0], quote=quote
                ))
    elif args.scenario == "figures":
        from backend.model_usage import bind
        from backend.pdf_structure import recognize
        from backend.translation_settings import read_config

        python = os.environ["PDF_STRUCTURE_PYTHON"]
        for label, mode, effort in variants(bench, model, args):
            bench.set_options(model["id"], mode, effort)
            config = read_config(bench.settings, bench.owner, model["id"])
            try:
                from backend.model_options import task_options

                config = {**config, **task_options(config, "extract")}
            except ImportError:
                pass  # older code: the reader's own strength applies
            marker = f"figures-{uuid.uuid4().hex[:8]}"
            config = bind(config, bench.app.state.maker, bench.settings, bench.owner, "pdf_structure", marker)
            for _ in range(args.repeat):
                started = time.monotonic()
                error, blocks = "", 0
                try:
                    blocks = len(recognize(bench.settings, bench.file["id"], pages[0], config, python).get("blocks", []))
                except Exception as e:  # noqa: BLE001
                    error = str(e)[:100]
                emit(args.dir, "figures", f"{tag} {label}", {
                    "seconds": round(time.monotonic() - started, 1),
                    "status": "failed" if error else "completed",
                    "error": error,
                    "blocks": blocks,
                    "usage": bench.usage(marker),
                })
    elif args.scenario == "region":
        for label, mode, effort in variants(bench, model, args):
            bench.set_options(model["id"], mode, effort)
            for _ in range(args.repeat):
                emit(args.dir, "region", f"{tag} {label}", bench.reader_run(
                    model["id"], "translate", "region", page=pages[0], rect=[0.1, 0.1, 0.8, 0.3]
                ))
    elif args.scenario in {"guide", "quiz", "outline", "highlights"}:
        kind = args.scenario
        for label, mode, effort in variants(bench, model, args):
            bench.set_options(model["id"], mode, effort)
            for _ in range(args.repeat):
                emit(args.dir, kind, f"{tag} {label}", bench.timed_artifact(model["id"], kind))
    elif args.scenario == "latex":
        latex(bench, model, args, tag)
    else:
        raise SystemExit(f"unknown scenario {args.scenario}")


if __name__ == "__main__":
    main()
