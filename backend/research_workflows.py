# ruff: noqa: B008
"""Versioned definitions, immutable snapshots and step boundaries."""

import json
from copy import deepcopy
from pathlib import PurePosixPath
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import Field, field_validator, model_validator
from sqlalchemy import select, update

from .models import ResearchCard, ResearchProject, ResearchWorkflow, now
from .schemas import Strict


def output_path(value):
    path = PurePosixPath(value)
    if (
        not value
        or len(value) > 500
        or value.startswith("/")
        or "\\" in value
        or "\0" in value
        or any(p in {"..", ".git"} for p in path.parts)
    ):
        raise ValueError("产出路径必须在研究工作区内")
    return path.as_posix()


class StepInput(Strict):
    name: str = Field(min_length=1, max_length=200)
    type: Literal["agent", "plan", "experiment", "review"] = "agent"
    instructions: str = Field(default="", max_length=20000)
    outputs: list[str] = Field(default_factory=list, max_length=30)
    confirmation: bool = False
    max_rounds: int | None = Field(default=None, ge=1, le=200)
    max_retries: int = Field(default=2, ge=0, le=10)
    action: Literal["child_research", "conclusion", "retrospective"] | None = None

    @model_validator(mode="after")
    def defaults(self):
        if self.type in {"agent", "review"} and self.max_rounds is None:
            self.max_rounds = 3
        if self.type != "agent":
            self.action = None
        return self

    @field_validator("name")
    @classmethod
    def trim(cls, value):
        if not value.strip():
            raise ValueError("步骤名称不能为空")
        return value.strip()

    @field_validator("outputs")
    @classmethod
    def paths(cls, value):
        return list(dict.fromkeys(output_path(p) for p in value))


class WorkflowInput(Strict):
    name: str = Field(min_length=1, max_length=200)
    steps: list[StepInput] = Field(min_length=1, max_length=30)
    version: int | None = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def trim(cls, value):
        if not value.strip():
            raise ValueError("工作流名称不能为空")
        return value.strip()

    @model_validator(mode="after")
    def review_target(self):
        if self.steps[0].type == "review":
            raise ValueError("评审前需要一个步骤")
        return self


def step(name, kind, instructions="", outputs=(), **extra):
    return {
        **StepInput(
            name=name, type=kind, instructions=instructions, outputs=list(outputs)
        ).model_dump(),
        **extra,
    }


LITERATURE = [
    step(
        "收集论文",
        "agent",
        "从资料库与检索中收集相关论文，记录来源。",
        ["review/sources.md"],
    ),
    step(
        "精读要点",
        "agent",
        "逐篇整理问题、方法、结果、局限，并注明出处。",
        ["review/notes.md"],
    ),
    step("综述成文", "agent", "依据来源和精读要点撰写文献综述。", ["review/review.md"]),
    step("评审", "review", "评审综述的准确性、覆盖面和引用。"),
]
WRITING = [
    step(
        "汇总项目结论",
        "agent",
        "读取项目记忆及各研究结论，整理论文提纲。",
        ["paper/outline.md"],
    ),
    step("写草稿", "agent", "依据提纲与真实研究证据撰写论文草稿。", ["paper/draft.md"]),
    step(
        "自审",
        "review",
        "检查论点、证据和引用；不通过就给出具体修改意见。",
        confirmation=True,
    ),
]
BUILTINS = {
    "research": {
        "name": "研究",
        "legacy": True,
        "steps": [
            step("定题", "plan", stage="scoping"),
            step("实验", "experiment", stage="experiments", max_rounds=200),
            step(
                "结论",
                "agent",
                "总结实验结论，等待研究者确认。",
                stage="conclusion",
                action="conclusion",
                confirmation=True,
            ),
            step(
                "复盘",
                "agent",
                "提炼本次研究的经验。",
                stage="retrospective",
                action="retrospective",
            ),
        ],
    },
    "literature-review": {"name": "文献综述", "steps": LITERATURE},
    "reproduction": {
        "name": "复现一篇论文",
        "steps": [
            step("选定论文", "plan", "说清复现哪个结果、怎么算成功。"),
            step("复现实验", "experiment", max_rounds=200),
            step(
                "对比报告",
                "agent",
                "对照论文数字，撰写复现结果与差异。",
                ["reproduction.md"],
            ),
        ],
    },
    "paper-writing": {"name": "写论文", "steps": WRITING},
    "read-to-write": {
        "name": "从读到写",
        "steps": [
            *LITERATURE,
            step(
                "找方向",
                "agent",
                "从综述中提出 3–5 个可做的问题，以 idea 卡片作为产出，等待研究者选择。",
                confirmation=True,
            ),
            step("研究", "agent", action="child_research"),
            *WRITING,
        ],
    },
}


def definition(d, owner, id="research"):
    if id in BUILTINS:
        return deepcopy({"id": id, "version": 1, "builtin": True, **BUILTINS[id]})
    row = d.get(ResearchWorkflow, id)
    if row is None or row.owner != owner:
        raise HTTPException(404, "工作流不存在")
    return {
        "id": row.id,
        "name": row.name,
        "version": row.version,
        "builtin": False,
        "steps": deepcopy(row.definition["steps"]),
    }


def _event(d, project, action, detail, sprint=None):
    from .research_map import event

    event(d, project, None, "system", action, detail, sprint.id if sprint else None)
    project.updated_at = now()


def snapshot(d, project, id="research"):
    project.workflow = definition(d, project.owner, id)
    project.workflow_state = {
        "current": 0,
        "steps": [
            {
                "status": "pending",
                "attempt": 0,
                "rounds": 0,
                "summary": "",
                "outputs": [],
                "started_at": None,
                "finished_at": None,
            }
            for _ in project.workflow["steps"]
        ],
    }
    if project.workflow.get("legacy"):
        sync_legacy(d, project)
    else:
        activate(d, project)


def legacy_state(project):
    stages = ["scoping", "experiments", "conclusion", "retrospective", "done"]
    index = stages.index(project.stage) if project.stage in stages else 1
    states = [
        {
            "status": "completed" if i < index else "pending",
            "outputs": [],
            "summary": "",
        }
        for i in range(4)
    ]
    if index < 4:
        states[index]["status"] = (
            "waiting" if project.status == "waiting" else "running"
        )
    return {"current": index, "steps": states}


def view(project):
    workflow = project.workflow or {
        "id": "research",
        "version": 1,
        "builtin": True,
        **deepcopy(BUILTINS["research"]),
    }
    state = deepcopy(project.workflow_state)
    if workflow.get("legacy"):
        projected = legacy_state(project)
        projected["steps"] = [
            {
                **(state.get("steps") or [{}] * 4)[i],
                **item,
                "outputs": (state.get("steps") or [{}] * 4)[i].get("outputs", []),
                "summary": (state.get("steps") or [{}] * 4)[i].get("summary", ""),
            }
            for i, item in enumerate(projected["steps"])
        ]
        state = projected
    return {**workflow, "state": state}


def sync_legacy(d, project):
    if not project.workflow.get("legacy"):
        return
    old = project.workflow_state or {}
    state = legacy_state(project)
    for i, item in enumerate(state["steps"]):
        previous = (old.get("steps") or [{}] * 4)[i]
        item.update({k: v for k, v in previous.items() if k != "status"})
        if item["status"] != previous.get("status"):
            if item["status"] == "completed":
                item["finished_at"] = now()
                item["checkpoint_pending"] = bool(previous.get("started_at"))
                item["summary"] = (
                    project.plan.get("summary", "")
                    if i == 0
                    else project.conclusion.get("summary", "")
                )
                _event(
                    d,
                    project,
                    "workflow_step_finished",
                    {
                        "index": i,
                        "name": project.workflow["steps"][i]["name"],
                        "status": "completed",
                        "outputs": [],
                    },
                )
            elif item["status"] in {"running", "waiting"}:
                item["started_at"] = item.get("started_at") or now()
                _event(
                    d,
                    project,
                    "workflow_step_started",
                    {
                        "index": i,
                        "name": project.workflow["steps"][i]["name"],
                        "status": item["status"],
                    },
                )
    project.workflow_state = state


def current(project):
    if not project.workflow or project.workflow.get("legacy"):
        return None
    index = project.workflow_state["current"]
    return (
        project.workflow["steps"][index]
        if index < len(project.workflow["steps"])
        else None
    )


def activate(d, project):
    spec = current(project)
    if spec is None:
        project.status, project.stage, project.end_reason = (
            "finished",
            "done",
            "concluded",
        )
        return
    state = deepcopy(project.workflow_state)
    item = state["steps"][state["current"]]
    item.update(
        status="running",
        attempt=item["attempt"] + 1,
        rounds=0,
        started_at=now(),
        finished_at=None,
    )
    project.workflow_state = state
    project.status = "active"
    project.stage = {"plan": "scoping", "experiment": "experiments"}.get(
        spec["type"], "workflow"
    )
    _event(
        d,
        project,
        "workflow_step_started",
        {
            "index": state["current"],
            "name": spec["name"],
            "status": "running",
            "attempt": item["attempt"],
        },
    )
    if spec.get("action") == "conclusion" and project.conclusion:
        project.stage, project.status = "conclusion", "waiting"
        item["status"] = "waiting"
        project.workflow_state = deepcopy(state)
        _event(
            d,
            project,
            "decision_requested",
            {
                "kind": "conclusion",
                "status": project.conclusion["status"],
                "reason": project.conclusion.get("summary", ""),
            },
        )
    elif spec.get("action") == "retrospective":
        project.stage, project.status = "retrospective", "finished"
    elif spec["type"] == "experiment" and item["attempt"] > 1:
        project.conclusion = {}


def _next(d, project):
    state = deepcopy(project.workflow_state)
    state["current"] += 1
    project.workflow_state = state
    activate(d, project)


def complete(d, project, summary, outputs, sprint=None, *, confirmed=False):
    spec = current(project)
    if spec is None:
        raise ValueError("当前没有工作流步骤")
    state = deepcopy(project.workflow_state)
    index = state["current"]
    item = state["steps"][index]
    waiting = spec["confirmation"] and not confirmed
    item.update(
        status="waiting" if waiting else "completed",
        summary=summary,
        outputs=outputs,
        finished_at=now(),
        sprint_id=sprint.id if sprint else None,
    )
    project.workflow_state = state
    _event(
        d,
        project,
        "workflow_step_finished",
        {"index": index, "name": spec["name"], **item},
        sprint,
    )
    if waiting:
        project.status = "waiting"
        _event(
            d,
            project,
            "decision_requested",
            {
                "kind": "workflow_step",
                "index": index,
                "attempt": item["attempt"],
                "reason": summary,
                "outputs": outputs,
                "choices": [
                    {"id": card.id, "title": card.title}
                    for id in item.get("cards", [])
                    if (card := d.get(ResearchCard, id)) is not None
                ],
            },
            sprint,
        )
    else:
        _next(d, project)


def native_complete(d, project, kind, summary):
    spec = current(project)
    if not spec or spec["type"] != kind:
        return False
    state = deepcopy(project.workflow_state)
    state["steps"][state["current"]]["checkpoint_pending"] = True
    project.workflow_state = state
    complete(d, project, summary, [], confirmed=True)
    return True


def complete_action(d, project, action, summary=""):
    spec = current(project)
    if not spec or spec.get("action") != action:
        return False
    state = deepcopy(project.workflow_state)
    state["steps"][state["current"]]["checkpoint_pending"] = True
    project.workflow_state = state
    complete(d, project, summary, [], confirmed=True)
    return True


def separate_conclusion(d, project):
    spec = current(project)
    if not spec or spec["type"] != "experiment":
        return False
    index = project.workflow_state["current"] + 1
    steps = project.workflow["steps"]
    if index < len(steps) and steps[index].get("action") == "conclusion":
        return native_complete(
            d, project, "experiment", project.conclusion.get("summary", "")
        )
    return False


def reject_conclusion(d, project, note):
    spec = current(project)
    if not spec or spec.get("action") != "conclusion":
        return False
    state = deepcopy(project.workflow_state)
    index = state["current"]
    if index and project.workflow["steps"][index - 1]["type"] == "experiment":
        state["current"] -= 1
    state["steps"][state["current"]]["human_note"] = note
    project.workflow_state = state
    activate(d, project)
    return True


def decide(d, project, request, approve, note):
    if request.detail.get("kind") != "workflow_step":
        return False
    state = deepcopy(project.workflow_state)
    index = state["current"]
    item = state["steps"][index]
    if (
        request.detail.get("index") != index
        or request.detail.get("attempt") != item["attempt"]
        or item["status"] not in {"waiting", "blocked"}
    ):
        raise HTTPException(409, "步骤已经更新")
    item["human_note"] = note
    project.workflow_state = state
    if approve and item["status"] == "waiting":
        item["status"] = "completed"
        item["finished_at"] = now()
        project.workflow_state = deepcopy(state)
        _event(
            d,
            project,
            "workflow_step_finished",
            {"index": index, "name": current(project)["name"], **item},
        )
        _next(d, project)
    else:
        activate(d, project)
    return True


def _pi(settings, d, project, name, args):
    from .research_sandbox import pi_call

    result = pi_call(settings, project.id, name, args, d)
    if result.get("isError"):
        raise ValueError(str(result.get("content", "产出操作失败"))[:1000])
    return result


def persist(settings, d, project, text, outputs, *, readonly=False):
    """Materialize cards and the handoff through the same sandbox as file tools."""
    state = project.workflow_state
    index = state["current"]
    attempt = state["steps"][index]["attempt"]
    paths = []
    cards = []
    for n, output in enumerate(outputs):
        if isinstance(output, str):
            path = output_path(output)
        elif isinstance(output, dict) and not readonly:
            path = output_path(
                output.get("path")
                or f"workflow/step-{index + 1}-{attempt}-card-{n + 1}.md"
            )
            content = output.get("content", "")
            title = output.get("title", path)
            if (
                not isinstance(content, str)
                or not isinstance(title, str)
                or len(content) > 100000
            ):
                raise ValueError("产出卡片无效")
            _pi(
                settings,
                d,
                project,
                "write",
                {"path": path, "content": f"# {title}\n\n{content}\n"},
            )
            if output.get("kind") == "idea":
                from .models import ResearchWorkspace
                from .research_workspaces import add_card

                workspace = d.get(ResearchWorkspace, project.workspace_id)
                if not workspace or workspace.owner != project.owner:
                    raise ValueError("项目不可用")
                card = add_card(d, workspace, title, content)
                card.created_by = "agent"
                cards.append(card.id)
        else:
            raise ValueError("产出必须是文件路径或卡片")
        _pi(settings, d, project, "read", {"path": path, "offset": 1, "limit": 1})
        paths.append(path)
    missing = set(current(project)["outputs"]) - set(paths)
    if missing and not readonly:
        raise ValueError("缺少产出：" + ", ".join(sorted(missing)))
    handoff = f"workflow/step-{index + 1}-{attempt}.md"
    _pi(
        settings,
        d,
        project,
        "write",
        {"path": handoff, "content": text + "\n\n" + "\n".join(paths) + "\n"},
    )
    if cards:
        updated = deepcopy(project.workflow_state)
        updated["steps"][index]["cards"] = cards
        project.workflow_state = updated
    return list(dict.fromkeys([*paths, handoff]))


def finish_step(settings, d, project, sprint, args):
    if (
        not current(project)
        or current(project)["type"] != "agent"
        or sprint.role != "workflow"
    ):
        raise ValueError("finish_step 只在 agent 步骤可用")
    summary = args["summary"]
    if not isinstance(summary, str) or not 1 <= len(summary.strip()) <= 8000:
        raise ValueError("摘要不能为空")
    if not isinstance(args.get("outputs"), list) or len(args["outputs"]) > 30:
        raise ValueError("产出列表无效")
    summary = summary.strip()
    outputs = persist(settings, d, project, summary, args.get("outputs", []))
    sprint.status, sprint.summary, sprint.updated_at = "ended", summary, now()
    complete(d, project, summary, outputs, sprint)
    return {"finished": True, "outputs": outputs}


def review_step(settings, d, project, sprint, args):
    spec = current(project)
    if not spec or spec["type"] != "review" or sprint.role != "review":
        raise ValueError("review_step 只在 review 步骤可用")
    notes = args["notes"]
    if (
        not isinstance(args["pass"], bool)
        or not isinstance(notes, str)
        or not 1 <= len(notes.strip()) <= 8000
    ):
        raise ValueError("评审结果无效")
    notes = notes.strip()
    outputs = persist(settings, d, project, notes, [], readonly=True)
    sprint.status, sprint.summary, sprint.updated_at = "ended", notes, now()
    if args["pass"]:
        complete(d, project, notes, outputs, sprint)
    else:
        state = deepcopy(project.workflow_state)
        index = state["current"]
        item = state["steps"][index]
        retries = item.get("retries", 0) + 1
        item.update(
            status="rejected",
            summary=notes,
            outputs=outputs,
            finished_at=now(),
            retries=retries,
        )
        project.workflow_state = state
        _event(
            d,
            project,
            "workflow_step_finished",
            {"index": index, "name": spec["name"], **item},
            sprint,
        )
        if retries > spec["max_retries"]:
            block(d, project, notes, sprint)
        else:
            state["current"] -= 1
            state["steps"][index - 1]["review_notes"] = notes
            project.workflow_state = deepcopy(state)
            activate(d, project)
    return {"passed": args["pass"], "outputs": outputs}


def block(d, project, reason, sprint=None):
    state = deepcopy(project.workflow_state)
    index = state["current"]
    item = state["steps"][index]
    item["status"] = "blocked"
    project.workflow_state = state
    project.status = "waiting"
    _event(
        d,
        project,
        "decision_requested",
        {
            "kind": "workflow_step",
            "index": index,
            "attempt": item["attempt"],
            "reason": reason,
        },
        sprint,
    )


def install_workflow_routes(app, settings, db, auth, allowed, owned):
    @app.get("/api/v1/research/workflows")
    def listing(a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        ids = list(BUILTINS) + list(
            d.scalars(
                select(ResearchWorkflow.id)
                .where(ResearchWorkflow.owner == a["id"])
                .order_by(ResearchWorkflow.created_at)
            )
        )
        return [definition(d, a["id"], id) for id in ids]

    @app.post("/api/v1/research/workflows")
    def create(body: WorkflowInput, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        row = ResearchWorkflow(
            owner=a["id"],
            name=body.name,
            definition={"steps": [s.model_dump() for s in body.steps]},
        )
        d.add(row)
        d.commit()
        return definition(d, a["id"], row.id)

    @app.get("/api/v1/research/workflows/{id}")
    def read(id: str, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        return definition(d, a["id"], id)

    @app.put("/api/v1/research/workflows/{id}")
    def edit(id: str, body: WorkflowInput, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        if id in BUILTINS:
            raise HTTPException(409, "内置工作流只读")
        row = owned(d, ResearchWorkflow, id, a)
        result = d.execute(
            update(ResearchWorkflow)
            .where(
                ResearchWorkflow.id == row.id, ResearchWorkflow.version == body.version
            )
            .values(
                name=body.name,
                definition={"steps": [s.model_dump() for s in body.steps]},
                version=ResearchWorkflow.version + 1,
                updated_at=now(),
            )
        )
        if not result.rowcount:
            raise HTTPException(409, "工作流已经更新")
        d.commit()
        return definition(d, a["id"], id)

    @app.delete("/api/v1/research/workflows/{id}")
    def delete(id: str, a=Depends(auth), d=Depends(db)):
        allowed(a, d)
        if id in BUILTINS:
            raise HTTPException(409, "内置工作流只读")
        row = owned(d, ResearchWorkflow, id, a)
        d.delete(row)
        d.commit()
        return {"deleted": True}


def round_started(project):
    if not current(project):
        return
    state = deepcopy(project.workflow_state)
    state["steps"][state["current"]]["rounds"] += 1
    project.workflow_state = state


def round_ended(d, project, sprint):
    if not current(project):
        return
    state = deepcopy(project.workflow_state)
    state["steps"][state["current"]]["last_round"] = sprint.summary
    project.workflow_state = state


def checkpoints(settings, d, project):
    """Seal native plan/experiment transitions before scheduling their successor."""
    from types import SimpleNamespace

    from . import research_repo
    from .models import ResearchWorkspace

    if not project.workflow:
        return True
    state = deepcopy(project.workflow_state)
    for index, item in enumerate(state.get("steps", [])):
        if not item.get("checkpoint_pending"):
            continue
        workspace = d.get(ResearchWorkspace, project.workspace_id)
        if not workspace or workspace.owner != project.owner:
            return False
        try:
            research_repo.adopt(settings, workspace, project)
            path = f"workflow/step-{index + 1}-{item.get('attempt', 1)}.md"
            text = item.get("summary", "") or project.workflow["steps"][index]["name"]
            content = (
                json.dumps(project.plan, ensure_ascii=False, indent=2)
                if project.workflow["steps"][index]["type"] == "plan"
                else text
            )
            _pi(
                settings, d, project, "write", {"path": path, "content": content + "\n"}
            )
            boundary = SimpleNamespace(number=index + 1, summary=text, commit_sha="")
            commit = research_repo.commit_round(settings, project, boundary)
            if not commit:
                return False
            item.update(commit_sha=commit, outputs=[path], checkpoint_pending=False)
            _event(
                d,
                project,
                "workflow_step_checkpoint",
                {"index": index, "outputs": [path], "commit_sha": commit},
            )
        except (ValueError, OSError, RuntimeError) as exc:
            _event(d, project, "checkpoint_unavailable", {"reason": str(exc)[:500]})
            return False
    if state != project.workflow_state:
        project.workflow_state = state
    return True


def seal_pending(settings, maker):
    with maker() as d:
        ids = [
            p.id
            for p in d.scalars(select(ResearchProject))
            if any(
                s.get("checkpoint_pending")
                for s in (p.workflow_state or {}).get("steps", [])
            )
        ]
    for id in ids:
        with maker() as d:
            project = d.get(ResearchProject, id)
            from .models import AgentSession, ResearchWorkspace
            from .research_chat import lock_session
            from .research_workspaces import lock_workspace

            lock_session(d, d.get(AgentSession, project.session_id))
            workspace = (
                d.get(ResearchWorkspace, project.workspace_id)
                if project.workspace_id
                else None
            )
            if workspace:
                lock_workspace(d, workspace)
            d.refresh(project)
            checkpoints(settings, d, project)
            d.commit()


def child_tick(settings, d, project):
    from . import research_chat, research_repo
    from .models import ResearchWorkspace

    state = deepcopy(project.workflow_state)
    index = state["current"]
    item = state["steps"][index]
    child_id = item.get("child_id")
    if not child_id:
        previous = state["steps"][index - 1]
        chosen = previous.get("human_note", "").strip()
        cards = [d.get(ResearchCard, id) for id in previous.get("cards", [])]
        if not chosen and not item.get("human_note", "").strip() and len(cards) > 1:
            block(d, project, "选择研究方向")
            return
        question = (
            chosen
            or item.get("human_note", "").strip()
            or (cards[0].title if cards else project.question)
        )
        selected = next(
            (card for card in cards if card and card.title == question), None
        )
        background = "\n\n".join(
            filter(
                None,
                [
                    previous.get("summary", ""),
                    selected.body if selected else "",
                    "\n".join(previous.get("outputs", [])),
                ],
            )
        )
        workspace = d.get(ResearchWorkspace, project.workspace_id)
        child = research_chat.start_research(
            settings,
            d,
            project.owner,
            workspace,
            question[:2000],
            background[:20000],
            project.model_config_id,
        )
        child.parent_id = project.id
        d.flush()
        commit = previous.get("commit_sha")
        if not commit:
            raise ValueError("上一步没有检查点")
        research_repo.fork_thread(settings, workspace, project, child, commit)
        if selected:
            selected.project_id = child.id
        item["child_id"] = child.id
        project.workflow_state = state
        _event(
            d,
            project,
            "workflow_child_started",
            {"index": index, "research_id": child.id},
        )
        return
    child = d.get(ResearchProject, child_id)
    if not child or child.owner != project.owner or child.parent_id != project.id:
        raise ValueError("子研究不可用")
    if child.status != "finished" or child.stage != "done":
        return
    if child.end_reason not in {"concluded", "refuted"}:
        block(d, project, "子研究未完成")
        return
    item["checkpoint_pending"] = True
    project.workflow_state = state
    complete(d, project, child.conclusion.get("summary", ""), [], confirmed=True)
