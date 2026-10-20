"""Research environments, prepared by an agent rather than by a fixed script.

An environment is a machine (this one, its Docker, or one reached over SSH)
plus what it must offer experiments. Preparing it is an agent run: the agent
logs in, looks at what is there (GPU, driver, Python), installs what is
missing the way that machine needs, checks its work, and ends with
`finish_setup`, naming the Python to use and the steps that reproduce the
setup. The system then probes that Python itself; only if PyTorch imports
(and sees the GPU, when there is one) is the environment ready, as a new
version. A run that ends any other way leaves it failed, with the reason.

The state lives next to the environment in the research settings:
{status: new|preparing|ready|failed, version, python, recipe, summary,
 probe, run_id, prepared_at, error}.
"""

import json

from . import research_settings
from .models import AgentRun, AgentSession, now
from .translation_settings import read_config

DONE = {"completed", "failed", "cancelled"}
DEFAULT_NEEDS = (
    "Python 3，与这台机器的显卡和驱动匹配的 PyTorch（没有 GPU 就用 CPU 版），"
    "以及 numpy、scipy、scikit-learn、pandas、matplotlib。"
)


def state(settings, env_id):
    return research_settings.load(settings).get("states", {}).get(env_id, {})


def set_state(settings, env_id, **values):
    data = research_settings.load(settings)
    states = data.setdefault("states", {})
    states[env_id] = {**states.get(env_id, {}), **values}
    research_settings.save(settings, data)
    return states[env_id]


def _host_lines(settings, item, needs):
    from . import research_host

    folder = research_host.setup_dir(settings)
    return [
        "# 准备研究环境",
        f"## 机器\n{item['name']}：研究者自己的这台电脑，实验直接在这里运行（不经过容器）。",
        f"## 研究者需要这个环境提供\n{needs}",
        "## 权限\n不要使用 sudo，不要改系统 Python，也不要用 pip 往系统或用户全局装包："
        f"在 {folder} 下建一个独立的 Python 虚拟环境（推荐 `uv venv` 或 `python3 -m venv`），"
        "所有包装进这个虚拟环境。如果是 Apple 芯片的 Mac，装支持 MPS 的 PyTorch，并验证 "
        "`torch.backends.mps.is_available()`。",
        f"## 工作目录\n你的 bash 在 {folder} 里运行，可以联网下载。",
        "## 范围\n只准备环境。不要查看、修改或运行研究项目的任何东西，"
        "不要启动训练或实验，也不要找“任务说明文件”：要做的事就是这份简报。",
    ]


def brief(item, needs, allow_sudo, previous, settings=None):
    if item["kind"] == "host":
        lines = _host_lines(settings, item, needs)
        return "\n\n".join(lines + _closing(previous))
    lines = [
        "# 准备研究环境",
        f"## 机器\n{item['name']}（SSH 主机 {item['host']}，GPU 设置：{item.get('gpus') or '未指定'}）",
        f"## 研究者需要这个环境提供\n{needs}",
        "## 权限\n"
        + (
            "研究者允许使用 sudo（免密码）。只在确实需要系统包时用，并在 recipe 里写清。"
            if allow_sudo
            else "不要使用 sudo，也不要改系统 Python：所有东西装在用户主目录下。"
        ),
        "## 工作目录\n你的 bash 在这台机器的 ~/ora-setup 里运行，可以联网下载。",
        "## 范围\n只准备环境。不要查看、修改或运行研究项目的任何东西"
        f"（{item.get('remote_dir', '~/ora-research')} 下除 ora/ 以外的目录都是研究项目），"
        "不要启动训练或实验，也不要找“任务说明文件”：要做的事就是这份简报。",
    ]
    return "\n\n".join(lines + _closing(previous))


def _closing(previous):
    lines = []
    if previous.get("python"):
        lines.append(
            "## 上一次准备的结果（可以在它的基础上补装）\n"
            + json.dumps(
                {k: previous.get(k) for k in ("python", "recipe", "probe", "version")},
                ensure_ascii=False,
            )[:3000]
        )
    lines.append(
        "## 先检查现成的\n如果这台机器上已经有一个满足要求的环境（上一次准备的，或研究者自己装的），"
        "验证它能用之后立刻调用 finish_setup，不要重装，也不要继续四处查看。"
    )
    lines.append(
        "## 结束\n装好并亲自验证后，调用 finish_setup：python 填要用的解释器的绝对路径或 ~ 开头的路径，"
        "recipe 写一段能在一台同样的新机器上重做这次准备的 shell 脚本，summary 写给研究者看。"
    )
    return lines


def start(settings, d, owner, env_id, model_config_id, needs="", allow_sudo=False):
    """Starts the agent run that prepares an SSH environment."""
    item = research_settings.compute(settings, env_id)
    if item["kind"] == "docker":
        raise ValueError("本机 Docker 环境由镜像提供：make research-image")
    current = state(settings, env_id)
    if current.get("status") == "preparing":
        run = d.get(AgentRun, current.get("run_id"))
        if run is not None and run.status not in DONE:
            raise ValueError("这个环境正在准备中")
    config = read_config(settings, owner, model_config_id)
    if not config.get("model"):
        raise ValueError("请先添加并选择可用模型")
    needs = (needs or "").strip()[:2000] or DEFAULT_NEEDS
    session = AgentSession(owner=owner, title=f"准备研究环境：{item['name']}"[:100])
    d.add(session)
    d.flush()
    run = AgentRun(
        owner=owner,
        session_id=session.id,
        model_config_id=model_config_id,
        model=config["model"],
        prompt=brief(item, needs, allow_sudo, current, settings),
        context="",
        writable=True,
        lane="research",
        runtime={
            "research": {
                "role": "envsetup",
                "env_id": env_id,
                "allow_sudo": bool(allow_sudo),
            }
        },
    )
    d.add(run)
    d.flush()
    set_state(
        settings,
        env_id,
        status="preparing",
        run_id=run.id,
        needs=needs,
        allow_sudo=bool(allow_sudo),
        error="",
        started_at=now(),
    )
    return run


def usable(probe, item):
    """Why a probed Python cannot host experiments, or "" if it can."""
    packages = probe.get("packages") or {}
    if "torch" not in packages:
        return "这个 Python 里导入不了 PyTorch"
    if item.get("gpus") and not probe.get("cuda"):
        return "配置了 GPU，但 PyTorch 看不到 CUDA"
    return ""


def finish(settings, env_id, args):
    """The agent says it is done: the system checks for itself before believing it."""
    from . import research_host, research_remote

    item = research_settings.compute(settings, env_id)
    python = (args.get("python") or "").strip()
    if not research_settings.REMOTE_DIR.match(python) or ".." in python:
        raise ValueError("python 路径不合法")
    if item["kind"] == "host":
        probe = research_host.probe(settings, {**item, "python": python})
    else:
        probe = research_remote.probe({**item, "python": python})
    problem = usable(probe, item)
    if problem:
        raise ValueError(
            f"系统检查没有通过：{problem}。检测结果：{json.dumps(probe, ensure_ascii=False)[:800]}"
        )
    previous = state(settings, env_id)
    done = set_state(
        settings,
        env_id,
        status="ready",
        version=int(previous.get("version") or 0) + 1,
        python=python,
        recipe=(args.get("recipe") or "")[:20000],
        summary=(args.get("summary") or "")[:4000],
        probe=probe,
        prepared_at=now(),
        error="",
    )
    return {"status": "ready", "version": done["version"], "probe": probe}


def settle(settings, maker):
    """A preparation whose run ended without finish_setup is marked failed."""
    data = research_settings.load(settings)
    for env_id, st in (data.get("states") or {}).items():
        if st.get("status") != "preparing":
            continue
        with maker() as d:
            run = d.get(AgentRun, st.get("run_id"))
            if run is None or run.status not in DONE:
                continue
            reason = (run.error or run.response or run.status or "")[:1000]
        set_state(settings, env_id, status="failed", error=reason)


def progress(settings, d, env_id):
    """The state, and what the preparing agent has done so far."""
    st = state(settings, env_id)
    run = d.get(AgentRun, st.get("run_id")) if st.get("run_id") else None
    steps = []
    for step in (run.steps or []) if run else []:
        args = step.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        result = step.get("result") or {}
        output = result.get("summary", "") if isinstance(result, dict) else str(result)
        try:
            # A tool's reply, kept as JSON text: show what it printed.
            parsed = json.loads(output)
            if isinstance(parsed, dict) and "content" in parsed:
                output = "\n".join(
                    c.get("text", "") for c in parsed["content"] if isinstance(c, dict)
                )
        except (ValueError, TypeError):
            pass
        steps.append(
            {
                "name": step.get("name"),
                "label": step.get("label", ""),
                "status": step.get("status"),
                "command": str(args.get("command") or args.get("path") or "")[:500]
                if isinstance(args, dict)
                else "",
                "output": str(step.get("error") or output)[-600:],
            }
        )
    return {
        "state": {k: v for k, v in st.items() if k != "probe"}
        | {"probe": st.get("probe") or {}},
        "run": {
            "status": run.status,
            "response": (run.response or "")[:4000],
        }
        if run
        else None,
        "steps": steps[-60:],
    }


def ready_python(settings, env_id):
    """The Python the environment's preparation settled on, if any."""
    return state(settings, env_id).get("python") or ""
