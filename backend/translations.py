# ruff: noqa: B008
"""HTTP control plane; translation and TeX compilation run in a separate worker."""

import hashlib
import re
from pathlib import Path
from typing import Literal

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .arxiv_import import NO_PDF, ArxivNotFound, download, identifier, metadata
from .import_progress import read as read_import_progress
from .import_progress import report, tracking
from .model_options import task_options
from .model_usage import ModelBudgetExceeded, bind
from .models import File, Paper, TranslationJob, Version, now, public
from .storage_budget import StorageBudgetExceeded, require_space, write_blob
from .translation_settings import (
    complete,
    delete_config,
    list_models,
    public_config,
    read_config,
    select_config,
    write_config,
)


class ModelInput(BaseModel):
    context_length: int | None = Field(default=None, ge=1, le=100000000)
    vision: bool = False
    id: str = Field(default="", max_length=36)
    name: str = Field(default="", max_length=100)
    protocol: Literal["openai", "anthropic"] = "openai"
    base_url: str = Field(max_length=500)
    model: str = Field(min_length=1, max_length=200)
    api_key: str = Field(default="", max_length=4096)


class ModelOptionsInput(BaseModel):
    thinking_mode: Literal["default", "disabled", "adaptive", "enabled"] = "default"
    reasoning_effort: Literal["default", "low", "medium", "high", "xhigh", "max"] = (
        "default"
    )


class TranslationInput(BaseModel):
    model_config_id: str = Field(default="", max_length=36)
    engine: Literal["latex", "pdf"] = "latex"
    source_file_id: str = Field(default="", max_length=36)


class ArxivInput(BaseModel):
    url: str = Field(min_length=1, max_length=300)


class ModelListInput(BaseModel):
    id: str = Field(default="", max_length=36)
    protocol: Literal["openai", "anthropic"] = "openai"
    base_url: str = Field(max_length=500)
    api_key: str = Field(default="", max_length=4096)


def probe(config):
    """A connection or vision check needs an answer, not reasoning."""
    return {**config, **task_options(config, "probe")}


def store_file(d, settings, paper, version_id, name, raw):
    from .main import detect

    if len(raw) > settings.upload_limit:
        raise ValueError("文件超过存储大小限制")
    require_space(d, settings, paper.owner, len(raw))
    mime, pages = detect(raw, name)
    f = File(
        owner=paper.owner,
        paper_id=paper.id,
        version_id=version_id,
        name=name,
        source_path=name,
        mime=mime,
        pages=pages,
        size=len(raw),
        sha256=hashlib.sha256(raw).hexdigest(),
    )
    d.add(f)
    d.flush()
    write_blob(settings, f.id, raw)
    return f


def import_arxiv_paper(d, settings, actor, url, snapshot, *, existing=None, tags=None):
    """Import metadata and a readable PDF atomically; repair metadata-only entries."""
    report("metadata")
    try:
        meta = metadata(url)
    except ValueError as error:
        # The reason is already written for the reader (no such paper, no
        # connection after three tries, ...); an internal one is not passed on.
        reason = str(error)
        if not re.search(r"[\u3400-\u9fff]", reason):
            reason = "无法获取 arXiv 论文，请检查链接或稍后重试"
        raise HTTPException(422, reason) from None
    except Exception:  # noqa: BLE001
        raise HTTPException(422, "无法获取 arXiv 论文，请检查链接或稍后重试") from None
    from .storage_budget import lock_owner

    # Deduplication and file creation share the same owner transaction lock.
    report("checking")
    lock_owner(d, actor["id"])
    base_id = re.sub(r"v\d+$", "", meta["arxiv_id"])
    if existing is None:
        for candidate in d.scalars(select(Paper).where(Paper.owner == actor["id"])):
            try:
                candidate_id = re.sub(r"v\d+$", "", identifier(candidate.external_id))
            except ValueError:
                continue
            if candidate_id == base_id:
                existing = candidate
                break
    if existing is not None:
        original = d.scalar(
            select(File).where(
                File.paper_id == existing.id,
                File.version_id == existing.current_version,
                File.owner == actor["id"],
                File.mime == "application/pdf",
            )
        )
        if original:
            return existing, None
    p = existing or Paper(
        owner=actor["id"],
        title=meta["title"],
        authors=meta["authors"],
        abstract=meta["abstract"],
        external_id="arxiv:" + meta["arxiv_id"],
        tags=tags or [],
    )
    d.add(p)
    d.flush()
    v = d.scalar(
        select(Version).where(
            Version.paper_id == p.id,
            Version.label == meta["arxiv_id"],
        )
    )
    if v is None:
        v = Version(
            owner=actor["id"],
            paper_id=p.id,
            label=meta["arxiv_id"],
            provenance="https://arxiv.org/abs/" + meta["arxiv_id"],
        )
        d.add(v)
        d.flush()
    try:
        report("pdf")
        try:
            raw = download("/pdf/" + meta["arxiv_id"])
        except ArxivNotFound:
            raise HTTPException(422, NO_PDF) from None
        if not raw.startswith(b"%PDF-"):
            # A page instead of the file is a transient answer; try again.
            raise ValueError("Invalid PDF")
        report("saving")
        f = store_file(
            d, settings, p, v.id, meta["arxiv_id"].replace("/", "-") + ".pdf", raw
        )
    except (HTTPException, StorageBudgetExceeded):
        # The inspector's reason (an encrypted or unreadable PDF), the missing
        # PDF above, and the storage limit are told as they are.
        raise
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "原版 PDF 下载失败，请重试；未保存本次导入") from None
    try:
        p.current_version = v.id
        p.external_id = "arxiv:" + meta["arxiv_id"]
        if existing is not None:
            p.revision += 1
            p.updated_at = now()
        snapshot(d, p, actor)
        if existing is None:
            from .notebooks import default_note

            snapshot(d, default_note(d, p, actor["actor"]), actor)
    except Exception:
        # The caller takes responsibility for commit cleanup only after we return.
        (Path(settings.storage) / f.id).unlink(missing_ok=True)
        raise
    return p, f


def install_translation_routes(
    app, settings, db, auth, human, owned, snapshot, idem, save
):
    @app.get("/api/v1/translation-settings")
    def config(a=Depends(auth)):
        human(a)
        return {
            **public_config(settings, a["id"]),
            "pdf_layout_enabled": bool(settings.pdf_layout_image),
        }

    @app.put("/api/v1/translation-settings")
    def update_config(body: ModelInput, a=Depends(auth)):
        human(a)
        try:
            return write_config(settings, a["id"], body.model_dump())
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.post("/api/v1/translation-settings/test")
    def test_config(a=Depends(auth)):
        human(a)
        config = read_config(settings, a["id"])
        if not config.get("api_key"):
            raise HTTPException(409, "请先保存模型配置")
        try:
            complete(
                bind(
                    probe(config), app.state.maker, settings, a["id"], "connection_test"
                ),
                "Reply with OK.",
                "Connection test",
            )
            return {"ok": True}
        except ModelBudgetExceeded as e:
            raise HTTPException(429, str(e)) from None
        except ValueError as e:
            raise HTTPException(502, str(e))

    @app.post("/api/v1/translation-settings/configs")
    def add_config(body: ModelInput, a=Depends(auth)):
        human(a)
        try:
            return write_config(settings, a["id"], body.model_dump(), create=True)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None

    @app.put("/api/v1/translation-settings/configs/{profile_id}/options")
    def update_options(profile_id: str, body: ModelOptionsInput, a=Depends(auth)):
        human(a)
        from .translation_settings import save_options

        try:
            return save_options(settings, a["id"], profile_id, body.model_dump())
        except ValueError as e:
            raise HTTPException(422, str(e)) from None

    @app.post("/api/v1/translation-settings/configs/{profile_id}/select")
    def activate(profile_id: str, a=Depends(auth)):
        human(a)
        try:
            return select_config(settings, a["id"], profile_id)
        except ValueError as e:
            raise HTTPException(404, str(e)) from None

    @app.delete("/api/v1/translation-settings/configs/{profile_id}")
    def remove_config(profile_id: str, a=Depends(auth), d=Depends(db)):
        human(a)
        active = d.scalar(
            select(TranslationJob.id).where(
                TranslationJob.owner == a["id"],
                TranslationJob.model_config_id == profile_id,
                TranslationJob.status.in_(["queued", "running"]),
            )
        )
        if active:
            raise HTTPException(409, "该模型仍有翻译任务，请完成或取消任务后移除")
        try:
            return delete_config(settings, a["id"], profile_id)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None

    @app.post("/api/v1/translation-settings/configs/{profile_id}/test")
    def test_saved(profile_id: str, a=Depends(auth)):
        human(a)
        value = read_config(settings, a["id"], profile_id)
        if not value:
            raise HTTPException(404, "模型配置不存在")
        try:
            complete(
                bind(
                    probe(value), app.state.maker, settings, a["id"], "connection_test"
                ),
                "Reply with OK.",
                "Connection test",
            )
            return {"ok": True}
        except ModelBudgetExceeded as e:
            raise HTTPException(429, str(e)) from None
        except ValueError as e:
            raise HTTPException(502, str(e)) from None

    @app.post("/api/v1/translation-settings/configs/{profile_id}/vision-test")
    def test_vision(profile_id: str, a=Depends(auth)):
        human(a)
        from .translation_settings import mutate_store, probe_vision

        config = read_config(settings, a["id"], profile_id)
        if config.get("shared"):
            raise HTTPException(403, "平台模型视觉能力由管理员配置")
        if not config:
            raise HTTPException(404, "模型配置不存在")
        try:
            probe_vision(
                bind(probe(config), app.state.maker, settings, a["id"], "vision_test")
            )

            def enable(store):
                row = next((r for r in store["models"] if r["id"] == profile_id), None)
                if row is None or any(
                    row.get(k) != config.get(k)
                    for k in ("model", "base_url", "protocol", "api_key")
                ):
                    raise ValueError("测试期间模型配置发生变化，请重试")
                row["vision"] = True

            return mutate_store(settings, a["id"], enable)
        except ModelBudgetExceeded as e:
            raise HTTPException(429, str(e)) from None
        except ValueError as e:
            raise HTTPException(502, str(e)) from None

    @app.post("/api/v1/translation-settings/models")
    def models(body: ModelListInput, a=Depends(auth)):
        human(a)
        try:
            return list_models(settings, a["id"], body.model_dump())
        except ValueError as e:
            raise HTTPException(422, str(e)) from None

    @app.post("/api/v1/import/arxiv")
    def import_arxiv(
        body: ArxivInput, request: Request, a=Depends(auth), d=Depends(db)
    ):
        key, fp, old = idem(d, a, request, body.model_dump())
        if old is not None:
            return old
        with tracking(settings, a["id"], request.headers.get("X-Import-ID", "")):
            p, f = import_arxiv_paper(d, settings, a, body.url, snapshot)
            try:
                return save(d, a, key, fp, public(p))
            except Exception:
                if f is not None:
                    (Path(settings.storage) / f.id).unlink(missing_ok=True)
                raise

    @app.get("/api/v1/import/arxiv/progress/{token}")
    def import_progress(token: str, a=Depends(auth)):
        return read_import_progress(settings, a["id"], token)

    @app.get("/api/v1/papers/{id}/translations")
    def list_jobs(id: str, a=Depends(auth), d=Depends(db)):
        owned(d, Paper, id, a)
        return [
            public(j)
            for j in d.scalars(
                select(TranslationJob)
                .where(TranslationJob.paper_id == id, TranslationJob.owner == a["id"])
                .order_by(TranslationJob.created_at.desc())
            )
        ]

    @app.post("/api/v1/papers/{id}/translations")
    def create_job(
        id: str, body: TranslationInput | None = None, a=Depends(auth), d=Depends(db)
    ):
        human(a)
        p = owned(d, Paper, id, a)
        config = read_config(
            settings, a["id"], (body.model_config_id or None) if body else None
        )
        if not config.get("api_key") or not config.get("model"):
            raise HTTPException(409, "请先选择可用翻译模型")
        engine = body.engine if body else "latex"
        source_id = ""
        arxiv = ""
        if engine == "pdf":
            if not settings.pdf_layout_image:
                raise HTTPException(409, "普通 PDF 版面翻译尚未启用")
            source = owned(d, File, body.source_file_id, a)
            if source.paper_id != p.id or source.version_id != p.current_version:
                raise HTTPException(422, "请选择当前论文版本的 PDF")
            if source.mime != "application/pdf":
                raise HTTPException(422, "版面翻译需要 PDF 文件")
            source_id = source.id
        else:
            try:
                arxiv = identifier(p.external_id)
            except ValueError:
                raise HTTPException(422, "请先填写该论文的 arXiv 编号")
            if not re.search(r"v\d+$", arxiv):
                raise HTTPException(
                    422, "翻译需要确定版本的 arXiv 编号，例如 2504.19413v1"
                )
        previous = d.scalar(
            select(TranslationJob).where(
                TranslationJob.owner == a["id"],
                TranslationJob.paper_id == id,
                TranslationJob.status.in_(["queued", "running"]),
            )
        )
        if previous:
            return public(previous)
        failed = d.scalar(
            select(TranslationJob)
            .where(
                TranslationJob.owner == a["id"],
                TranslationJob.paper_id == id,
                TranslationJob.version_id == p.current_version,
                TranslationJob.arxiv_id == arxiv,
                TranslationJob.engine == engine,
                TranslationJob.model == config["model"],
                TranslationJob.base_url == config["base_url"],
                TranslationJob.protocol == config.get("protocol", "openai"),
                TranslationJob.status == "failed",
            )
            .order_by(TranslationJob.created_at.desc())
        )
        latest_id = d.scalar(
            select(TranslationJob.id)
            .where(TranslationJob.owner == a["id"], TranslationJob.paper_id == id)
            .order_by(TranslationJob.created_at.desc())
        )
        if failed and failed.id != latest_id:
            failed = None
        if failed and engine == "pdf" and failed.source_file != source_id:
            failed = None
        j = failed or TranslationJob(
            owner=a["id"],
            paper_id=id,
            version_id=p.current_version,
            arxiv_id=arxiv,
            engine=engine,
            source_file=source_id,
            model=config["model"],
            base_url=config["base_url"],
            protocol=config.get("protocol", "openai"),
            model_config_id=config.get("id", ""),
        )
        if failed:
            j.model_config_id = config.get("id", "")
            j.status = "queued"
            j.stage = "继续未完成的翻译"
            if engine == "pdf":
                j.stage = "重新进行版面翻译"
                j.completed = 0
                j.total = 100
            j.error = ""
            j.updated_at = now()
        j.model_options = task_options(config, "translate")
        d.add(j)
        try:
            d.commit()
        except IntegrityError:
            d.rollback()
            raise HTTPException(409, "已有翻译任务，请刷新查看") from None
        return public(j)

    @app.post("/api/v1/translations/{id}/cancel")
    def cancel(id: str, a=Depends(auth), d=Depends(db)):
        human(a)
        j = owned(d, TranslationJob, id, a)
        if j.status in {"queued", "running"}:
            j.status = "cancelled"
            j.stage = "已取消"
            j.updated_at = now()
            d.commit()
        return public(j)
