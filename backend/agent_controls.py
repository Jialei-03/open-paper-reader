"""Durable controls for one live Pi run, never a later turn of its session."""

from typing import Literal
import threading
import time

from fastapi import Depends, HTTPException
from pydantic import Field
from sqlalchemy import select, update

from .agent_state import transition
from .models import (
    AgentControl,
    AgentRun,
    AgentSession,
    ResearchProject,
    ResearchWorkspace,
    now,
)
from .schemas import Strict

ACTIVE = {"queued", "running"}
PENDING = {"queued", "accepted"}
STOP_GRACE = 10


class ControlInput(Strict):
    expected_run_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    client_id: str = Field(min_length=1, max_length=100)
    kind: Literal["steer", "follow_up", "abort"]
    text: str = Field(default="", max_length=12000)


def output(control):
    return {
        name: getattr(control, name)
        for name in (
            "id",
            "session_id",
            "run_id",
            "client_id",
            "kind",
            "text",
            "status",
            "error",
            "created_at",
            "updated_at",
        )
    }


def stopping(run):
    return run.status == "cancelled" or bool(
        (run.runtime or {}).get("stop_requested_at")
    )


def _existing(d, owner, client_id):
    return d.scalar(
        select(AgentControl).where(
            AgentControl.owner == owner,
            AgentControl.client_id == client_id,
        )
    )


def request_abort(d, run, client_id):
    d.execute(
        update(AgentRun)
        .where(AgentRun.id == run.id)
        .values(updated_at=AgentRun.updated_at)
    )
    d.refresh(run)
    previous = _existing(d, run.owner, client_id)
    if previous is not None:
        if previous.run_id != run.id or previous.kind != "abort":
            raise ValueError("这条指令已经用于另一轮")
        return previous
    control = AgentControl(
        owner=run.owner,
        session_id=run.session_id,
        run_id=run.id,
        client_id=client_id,
        kind="abort",
        text="",
    )
    d.add(control)
    if run.status == "queued" or (run.runtime or {}).get("direct"):
        run.status = "cancelled"
        run.runtime = {**(run.runtime or {}), "settled": True}
        control.status = "applied"
    elif run.status == "running":
        run.runtime = {
            **transition(run.runtime, "stopping"),
            "stop_requested_at": (run.runtime or {}).get("stop_requested_at") or now(),
        }
    else:
        control.status, control.error = "rejected", "这一轮已经结束"
    run.updated_at = now()
    d.flush()
    return control


def _conversation(d, session, run):
    from .research_chat import session_out

    if d.scalar(
        select(ResearchProject.id)
        .where(ResearchProject.session_id == session.id)
        .limit(1)
    ):
        raise ValueError("研究轮次请在研究页里带话或暂停")
    workspace = None
    if session.workspace_id:
        workspace = d.get(ResearchWorkspace, session.workspace_id)
        if workspace is None or workspace.owner != session.owner:
            raise ValueError("会话不可用")
        d.execute(
            update(ResearchWorkspace)
            .where(ResearchWorkspace.id == workspace.id)
            .values(updated_at=ResearchWorkspace.updated_at)
        )
        d.refresh(workspace)
    capability = session_out(d, session, workspace=workspace)
    if session.archived_at or (workspace is not None and workspace.archived):
        raise ValueError("请先恢复这个会话或项目")
    if not capability["capabilities"]["steer"] or capability["active_run_id"] != run.id:
        raise ValueError("这个会话不支持当前追加指令")
    research = (run.runtime or {}).get("research") or {}
    if research.get("role") not in {None, "chat", "lead"}:
        raise ValueError("研究轮次请在研究页里带话或暂停")
    if any(
        (run.runtime or {}).get(key)
        for key in ("reading_artifact_id", "direct", "command")
    ):
        raise ValueError("这个任务不支持会话追加指令")


def enqueue(d, session, owner, body):
    # Serialize controls with the same session lock used when admitting a new turn.
    d.execute(
        update(AgentSession)
        .where(AgentSession.id == session.id)
        .values(updated_at=now())
    )
    d.refresh(session)
    previous = _existing(d, owner, body.client_id)
    if previous is not None:
        if (previous.session_id, previous.run_id, previous.kind, previous.text) != (
            session.id,
            body.expected_run_id,
            body.kind,
            body.text.strip(),
        ):
            raise ValueError("这条指令已经用于另一轮或其他内容")
        return previous
    run = d.get(AgentRun, body.expected_run_id)
    if run is None or run.owner != owner or run.session_id != session.id:
        raise ValueError("这一轮不属于这个会话")
    if run.status not in ACTIVE:
        raise ValueError("这一轮已经结束，请重新发送")
    if body.kind == "abort":
        return request_abort(d, run, body.client_id)
    _conversation(d, session, run)
    if stopping(run):
        raise ValueError("这一轮正在停止")
    text = body.text.strip()
    if not text:
        raise ValueError("消息不能为空")
    if d.scalar(
        select(AgentControl.id)
        .where(
            AgentControl.run_id == run.id,
            AgentControl.status.in_(PENDING),
        )
        .offset(19)
        .limit(1)
    ):
        raise ValueError("待处理消息已达上限")
    control = AgentControl(
        owner=owner,
        session_id=session.id,
        run_id=run.id,
        client_id=body.client_id,
        kind=body.kind,
        text=text,
    )
    d.add(control)
    d.flush()
    return control


def pending(maker, run_id):
    with maker() as d:
        return [
            output(row)
            for row in d.scalars(
                select(AgentControl)
                .where(
                    AgentControl.run_id == run_id,
                    AgentControl.status == "queued",
                )
                .order_by(AgentControl.created_at, AgentControl.id)
            )
        ]


def acknowledge(maker, run_id, identifier, status, error=""):
    if status not in {"accepted", "applied", "rejected"}:
        return
    with maker() as d:
        row = d.get(AgentControl, identifier)
        if row is None or row.run_id != run_id or row.status in {"applied", "rejected"}:
            return
        row.status, row.error, row.updated_at = status, str(error)[:300], now()
        d.commit()


def settle(d, run_id, aborted=False):
    for row in d.scalars(
        select(AgentControl).where(
            AgentControl.run_id == run_id,
            AgentControl.status.in_(PENDING),
        )
    ):
        row.status = "applied" if aborted and row.kind == "abort" else "rejected"
        row.error = "" if row.status == "applied" else "这一轮已结束，消息未执行"
        row.updated_at = now()


class Controller:
    """Deliver control while Python is waiting for a model slot or a business tool."""

    def __init__(self, maker, run_id, send):
        self.maker, self.run_id, self.send = maker, run_id, send
        self.sent = set()
        self.stop_started = None
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._watch, daemon=True)

    def start(self):
        self.thread.start()

    def close(self):
        self.closed.set()
        self.thread.join(timeout=1)

    def _watch(self):
        while not self.closed.is_set():
            with self.maker() as d:
                run = d.get(AgentRun, self.run_id)
                stop = run is None or stopping(run)
            rows = pending(self.maker, self.run_id)
            if (
                stop
                and self.stop_started is None
                and not any(row["kind"] == "abort" for row in rows)
            ):
                rows.append({"id": "legacy-abort", "kind": "abort", "text": ""})
            for row in rows:
                if row["id"] in self.sent:
                    continue
                if row["kind"] == "abort" and self.stop_started is None:
                    self.stop_started = time.monotonic()
                self.send(
                    {
                        "type": "control",
                        "expected_run_id": self.run_id,
                        **{key: row[key] for key in ("id", "kind", "text")},
                    }
                )
                self.sent.add(row["id"])
            self.closed.wait(0.1)


def install_control_routes(app, settings, db, auth, human, owned):
    @app.get("/api/v1/agent/sessions/{id}/controls")
    def controls(id: str, run_id: str = "", a=Depends(auth), d=Depends(db)):
        human(a)
        owned(d, AgentSession, id, a)
        statement = select(AgentControl).where(
            AgentControl.session_id == id,
            AgentControl.owner == a["id"],
        )
        if run_id:
            statement = statement.where(AgentControl.run_id == run_id)
        return [
            output(row)
            for row in d.scalars(
                statement.order_by(
                    AgentControl.created_at.desc(), AgentControl.id.desc()
                ).limit(100)
            )
        ][::-1]

    @app.post("/api/v1/agent/sessions/{id}/controls")
    def control(id: str, body: ControlInput, a=Depends(auth), d=Depends(db)):
        human(a)
        session = owned(d, AgentSession, id, a)
        try:
            row = enqueue(d, session, a["id"], body)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        d.commit()
        return output(row)
