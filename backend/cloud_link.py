"""The local edition linked to an account on a hosted site, so papers sync both ways.

Connecting signs in once with the account's name and password, makes a
read/write token named for this computer, and signs out again: only the token
is kept (in the data folder, readable by this user alone), never the password.

Syncing only adds. A paper the other side lacks is copied there with its PDF;
nothing is deleted or overwritten on either side. Papers are the same paper
when their PDFs have the same bytes (SHA-256), so syncing twice copies nothing
twice, and a paper imported on both sides is not doubled. Papers without a PDF
stay where they are. Notes, highlights and later edits are not synced yet.
"""

import json
import os
import socket
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from .models import File, Paper, Version, now
from .storage_budget import lock_owner
from .translations import store_file

TIMEOUT = httpx.Timeout(60, connect=15)
# Tests route the hosted site to an app in the same process.
TRANSPORT = None
LOOPBACK = {"127.0.0.1", "localhost", "::1"}


class ConnectInput(BaseModel):
    origin: str = Field(min_length=1, max_length=300)
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


def _path(settings):
    return Path(settings.storage).parent / "cloud-link.json"


def read(settings):
    path = _path(settings)
    try:
        return json.loads(path.read_text()) if path.exists() else {}
    except ValueError:
        return {}


def _write(settings, value):
    path = _path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(value, out, ensure_ascii=False)
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


def public(settings):
    """What the settings page shows: never the token."""
    link = read(settings)
    if not link.get("token"):
        return {"connected": False, "sync": _progress(settings)}
    return {
        "connected": True,
        "origin": link["origin"],
        "username": link["username"],
        "connected_at": link.get("connected_at", ""),
        "expires": link.get("expires", ""),
        "last_sync": link.get("last_sync"),
        "sync": _progress(settings),
    }


def check_origin(value):
    """The hosted site's address: https, or http only on this computer (tests)."""
    value = value.strip().rstrip("/")
    u = urlsplit(value)
    secure = u.scheme == "https" or (u.scheme == "http" and u.hostname in LOOPBACK)
    if (
        not secure
        or not u.hostname
        or u.username
        or u.password
        or u.path
        or u.query
        or u.fragment
    ):
        raise ValueError("请填写线上站点的地址，例如 https://papers.dougao.online")
    return value


def _client(origin, token=None):
    headers = {"Authorization": "Bearer " + token} if token else {}
    return httpx.Client(
        base_url=origin,
        headers=headers,
        timeout=TIMEOUT,
        follow_redirects=False,
        transport=TRANSPORT,
    )


def _reason(response):
    try:
        detail = response.json().get("detail")
    except ValueError:
        detail = None
    return detail if isinstance(detail, str) else f"HTTP {response.status_code}"


def connect(settings, origin, username, password):
    """Signs in once, keeps a token for this computer, signs out."""
    origin = check_origin(origin)
    try:
        with _client(origin) as c:
            r = c.post(
                "/api/v1/auth/login", json={"username": username, "password": password}
            )
            if r.status_code != 200:
                raise ValueError("登录失败：" + _reason(r))
            csrf = {"X-CSRF-Token": r.json()["csrf"]}
            name = ("本机版 · " + socket.gethostname())[:120]
            r = c.post(
                "/api/v1/tokens",
                json={"name": name, "scopes": ["read", "write"], "days": 365},
                headers=csrf,
            )
            if r.status_code != 200:
                raise ValueError("没能创建访问令牌：" + _reason(r))
            made = r.json()
            c.post("/api/v1/auth/logout", headers=csrf)
    except httpx.HTTPError as e:
        raise ValueError(f"连不上 {origin}：{e.__class__.__name__}") from None
    _write(
        settings,
        {
            "origin": origin,
            "username": username,
            "token": made["token"],
            "token_id": made["id"],
            "expires": made.get("expires", ""),
            "connected_at": now(),
        },
    )
    return public(settings)


def disconnect(settings):
    """Forgets the token here. Revoking it is done on the hosted site (Settings → Access)."""
    _path(settings).unlink(missing_ok=True)
    return public(settings)


# One sync at a time, in the background; its progress is read by the settings page.
_lock = threading.Lock()
_state = {}


def _progress(settings):
    return dict(_state.get(str(_path(settings)), {}))


def _pdf(files, current):
    """The paper's own PDF: the first one of its current version, else the first one."""
    pdfs = [f for f in files if f["mime"] == "application/pdf"]
    mine = [f for f in pdfs if f["version_id"] == current]
    return (mine or pdfs or [None])[0]


def _local_pdfs(d, owner):
    out = {}
    for paper in d.scalars(select(Paper).where(Paper.owner == owner)):
        files = [
            {
                "id": f.id,
                "name": f.name,
                "mime": f.mime,
                "version_id": f.version_id,
                "sha256": f.sha256,
            }
            for f in d.scalars(
                select(File)
                .where(File.owner == owner, File.paper_id == paper.id)
                .order_by(File.created_at)
            )
        ]
        pdf = _pdf(files, paper.current_version)
        if pdf is not None:
            out.setdefault(pdf["sha256"], (paper, pdf))
    return out


def _remote_pdfs(c):
    out, bare = {}, 0
    for archived in ("false", "true"):
        r = c.get("/api/v1/papers", params={"archived": archived})
        r.raise_for_status()
        for paper in r.json():
            r = c.get(f"/api/v1/papers/{paper['id']}/files")
            r.raise_for_status()
            pdf = _pdf(r.json(), paper.get("current_version", ""))
            if pdf is None:
                bare += 1
            else:
                out.setdefault(pdf["sha256"], (paper, pdf))
    return out, bare


def _download(d, settings, owner, actor, snapshot, origin, c, paper, pdf):
    from .notebooks import default_note

    r = c.get(f"/api/v1/files/{pdf['id']}/content", params={"download": "true"})
    r.raise_for_status()
    lock_owner(d, owner)
    p = Paper(
        owner=owner,
        title=paper["title"],
        authors=paper.get("authors", ""),
        abstract=paper.get("abstract", ""),
        external_id=paper.get("external_id", ""),
        tags=paper.get("tags") or [],
    )
    d.add(p)
    d.flush()
    v = Version(
        owner=owner,
        paper_id=p.id,
        label="pdf",
        provenance=f"{origin}/#read/{paper['id']}",
    )
    d.add(v)
    d.flush()
    f = store_file(d, settings, p, v.id, pdf["name"], r.content)
    try:
        p.current_version = v.id
        snapshot(d, p, actor)
        snapshot(d, default_note(d, p, actor["actor"]), actor)
        d.commit()
    except Exception:
        (Path(settings.storage) / f.id).unlink(missing_ok=True)
        raise


def _upload(settings, c, paper, pdf):
    # Keys named after the local paper and file: a retried sync finds what it made.
    r = c.post(
        "/api/v1/papers",
        json={
            "title": paper.title[:500],
            "authors": paper.authors[:4000],
            "abstract": paper.abstract[:50000],
            "external_id": paper.external_id[:200],
            "tags": paper.tags[:30],
            "version_label": "pdf",
            "provenance": "本机版",
        },
        headers={"Idempotency-Key": "local-sync-paper-" + paper.id},
    )
    r.raise_for_status()
    made = r.json()
    r = c.post(
        f"/api/v1/papers/{made['id']}/files",
        data={"version_id": made["current_version"]},
        files={
            "file": (
                pdf["name"],
                (Path(settings.storage) / pdf["id"]).read_bytes(),
                "application/pdf",
            )
        },
        headers={"Idempotency-Key": "local-sync-file-" + pdf["id"]},
    )
    r.raise_for_status()


def sync(settings, maker, owner, actor, snapshot):
    """Copies what each side lacks to the other; returns what it did."""
    link = read(settings)
    if not link.get("token"):
        raise ValueError("还没有连接线上账号")
    key = str(_path(settings))
    state = {"running": True, "phase": "listing", "done": 0, "total": 0}
    _state[key] = state
    result = {"downloaded": 0, "uploaded": 0, "without_pdf": 0, "errors": []}
    try:
        with _client(link["origin"], link["token"]) as c:
            remote, result["without_pdf"] = _remote_pdfs(c)
            with maker() as d:
                local = _local_pdfs(d, owner)
                pull = [remote[s] for s in remote if s not in local]
                push = [
                    (local[s][0].id, local[s][1]) for s in local if s not in remote
                ]
            state.update(phase="copying", total=len(pull) + len(push))
            for paper, pdf in pull:
                with maker() as d:
                    try:
                        _download(
                            d, settings, owner, actor, snapshot, link["origin"], c, paper, pdf
                        )
                        result["downloaded"] += 1
                    except (httpx.HTTPError, ValueError, OSError) as e:
                        d.rollback()
                        result["errors"].append(f"下载《{paper['title'][:60]}》失败：{e}"[:300])
                state["done"] += 1
            for paper_id, pdf in push:
                with maker() as d:
                    paper = d.get(Paper, paper_id)
                    try:
                        _upload(settings, c, paper, pdf)
                        result["uploaded"] += 1
                    except (httpx.HTTPError, ValueError, OSError) as e:
                        result["errors"].append(f"上传《{paper.title[:60]}》失败：{e}"[:300])
                state["done"] += 1
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            result["errors"].append("线上账号的访问令牌已失效或被撤销，请重新连接")
        else:
            result["errors"].append(f"线上站点返回错误：{_reason(e.response)}")
    except httpx.HTTPError as e:
        result["errors"].append(f"连不上 {link['origin']}：{e.__class__.__name__}")
    finally:
        state.update(running=False, phase="done")
    result["finished_at"] = now()
    current = read(settings)
    if current.get("token") == link["token"]:
        _write(settings, {**current, "last_sync": result})
    return result


def install_cloud_link_routes(app, settings, maker, auth, human, snapshot):
    """Only on the local edition: the hosted site never calls out on a user's behalf."""

    def start(a):
        if not _lock.acquire(blocking=False):
            raise HTTPException(409, "已经在同步了")

        def work():
            try:
                sync(settings, maker, a["id"], a, snapshot)
            except Exception as e:  # noqa: BLE001 — a failed sync is reported, not raised
                _state[str(_path(settings))] = {
                    "running": False,
                    "phase": "done",
                    "error": str(e)[:300],
                }
            finally:
                _lock.release()

        threading.Thread(target=work, name="cloud-sync", daemon=True).start()

    @app.get("/api/v1/cloud-link")
    def link_status(a=Depends(auth)):
        human(a)
        return public(settings)

    @app.post("/api/v1/cloud-link")
    def link_connect(body: ConnectInput, a=Depends(auth)):
        human(a)
        try:
            return connect(settings, body.origin, body.username, body.password)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None

    @app.delete("/api/v1/cloud-link")
    def link_disconnect(a=Depends(auth)):
        human(a)
        return disconnect(settings)

    @app.post("/api/v1/cloud-link/sync")
    def link_sync(a=Depends(auth)):
        human(a)
        if not read(settings).get("token"):
            raise HTTPException(409, "还没有连接线上账号")
        start(a)
        return public(settings)

