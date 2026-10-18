"""Layout translation (BabelDOC) installed on demand by the local build.

The hosted site runs BabelDOC in a container image (PDF_LAYOUT_IMAGE). The local
build has no image: the reader presses "Install layout translation" and BabelDOC
goes into its own virtual environment, ``<data dir>/babeldoc-venv``, never into
the web app's environment (it is AGPL-3.0 and pins its own dependencies). The
install runs in a temporary folder and is renamed into place only when every
step succeeded, so a cancelled or failed install leaves nothing half-done.
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from fastapi import Depends, HTTPException

BABELDOC = "BabelDOC==0.6.4"
# BabelDOC 0.6.4 imports `bitstring.BitStream`, which bitstring 5 removed; the
# same pins are in backend/requirements-layout.txt for the hosted image.
PINS = ("bitstring<5",)
# BabelDOC supports these Python versions (backend/requirements-layout.txt).
SUPPORTED_PYTHON = ((3, 10), (3, 14))
UV_PYTHON = "3.12"
WORKER = Path(__file__).resolve().with_name("layout_translation_worker.py")


def runtime_dir(settings):
    override = os.getenv("LAYOUT_RUNTIME_DIR")
    return Path(override) if override else Path(settings.storage).parent / "babeldoc-venv"


def venv_python(venv):
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def installed(settings):
    venv = runtime_dir(settings)
    return (venv / "installed.json").is_file() and venv_python(venv).exists()


def layout_available(settings):
    """Whether "translated" reading mode can run on this server."""
    return bool(settings.pdf_layout_image) or (
        settings.mode == "local" and installed(settings)
    )


def layout_runtime(settings):
    """The command that starts the layout worker outside a container, or None."""
    if settings.pdf_layout_image or settings.mode != "local" or not installed(settings):
        return None
    venv = runtime_dir(settings)
    worker = venv / "worker" / WORKER.name
    # Keep the installed worker in step with this release of the app.
    if not worker.exists() or worker.read_bytes() != WORKER.read_bytes():
        worker.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(WORKER, worker)
    # -I: the worker's folder, PYTHON* variables and user site-packages stay out.
    return [str(venv_python(venv)), "-I", str(worker)]


def patch_scripts():
    """Pinned BabelDOC fixes the hosted image applies too (deploy/translation)."""
    from .local.paths import BUNDLE, CHECKOUT

    names = ("patch_layout_fonts.py", "patch_layout_quality.py")
    for folder in (CHECKOUT / "deploy" / "translation", BUNDLE / "layout"):
        if all((folder / name).is_file() for name in names):
            return [folder / name for name in names]
    return []


def steps(target):
    """(stage, share of the progress bar, command) for each install step."""
    python = str(venv_python(target))
    uv = shutil.which("uv")
    if uv:
        create = [uv, "venv", "--python", UV_PYTHON, str(target)]
        install = [uv, "pip", "install", "--python", python, BABELDOC, *PINS]
    elif SUPPORTED_PYTHON[0] <= sys.version_info[:2] < SUPPORTED_PYTHON[1]:
        create = [sys.executable, "-m", "venv", str(target)]
        install = [python, "-m", "pip", "install", "--disable-pip-version-check", BABELDOC, *PINS]
    else:
        raise ValueError(
            "安装版面翻译需要 uv，或 Python 3.10–3.13；请先安装 uv（https://docs.astral.sh/uv/）"
        )
    return [
        ("environment", 10, create),
        ("engine", 60, install),
        *[("engine", 2, [python, "-I", str(script)]) for script in patch_scripts()],
        ("assets", 25, [python, "-I", "-c", "from babeldoc.assets.assets import warmup; warmup()"]),
    ]


class Installer:
    """One install at a time, owned by the web process; the state is in memory."""

    def __init__(self):
        self.lock = threading.Lock()
        self.cancelled = threading.Event()
        self.process = None
        self.thread = None
        self.state = {"status": "idle", "stage": "", "progress": 0, "error": ""}

    def status(self, settings):
        with self.lock:
            state = dict(self.state)
        return {
            **state,
            "supported": settings.mode == "local",
            "installed": installed(settings),
            "available": layout_available(settings),
        }

    def start(self, settings):
        if settings.mode != "local":
            raise HTTPException(409, "只有本机版需要安装版面翻译")
        if installed(settings):
            return self.status(settings)
        with self.lock:
            if self.state["status"] == "running":
                return {**self.state}
            self.cancelled.clear()
            self.state = {"status": "running", "stage": "environment", "progress": 0, "error": ""}
            self.thread = threading.Thread(
                target=self._run, args=(settings,), daemon=True, name="layout-install"
            )
            self.thread.start()
        return self.status(settings)

    def cancel(self, settings):
        self.cancelled.set()
        with self.lock:
            process = self.process
        if process and process.poll() is None:
            process.terminate()
        return self.status(settings)

    def _set(self, **values):
        with self.lock:
            self.state.update(values)

    def _run(self, settings):
        target = runtime_dir(settings)
        partial = target.with_name(target.name + ".partial")
        shutil.rmtree(partial, ignore_errors=True)
        partial.parent.mkdir(parents=True, exist_ok=True)
        done = 0
        try:
            for stage, share, command in steps(partial):
                self._set(stage=stage, progress=done)
                self._step(command, done, share)
                done += share
            self._set(stage="finish", progress=min(done, 99))
            worker = partial / "worker"
            worker.mkdir(exist_ok=True)
            shutil.copyfile(WORKER, worker / WORKER.name)
            (partial / "installed.json").write_text(
                json.dumps({"package": BABELDOC, "installed_at": time.time()})
            )
            shutil.rmtree(target, ignore_errors=True)
            partial.rename(target)
            self._set(status="completed", stage="", progress=100)
        except Exception as error:  # noqa: BLE001 - reported to the reader
            shutil.rmtree(partial, ignore_errors=True)
            if self.cancelled.is_set():
                self._set(status="cancelled", stage="", progress=0, error="")
            else:
                self._set(status="failed", error=str(error)[-600:] or "安装失败")
        finally:
            with self.lock:
                self.process = None

    def _step(self, command, start, share):
        if self.cancelled.is_set():
            raise RuntimeError("cancelled")
        env = {**os.environ, "PIP_NO_INPUT": "1", "PYTHONUNBUFFERED": "1"}
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            env=env,
        )
        with self.lock:
            self.process = process
        tail = []
        lines = 0
        for line in process.stdout:
            tail = (tail + [line.rstrip()])[-8:]
            lines += 1
            # Output lines are the only progress signal pip and uv give; move
            # through this step's share without ever finishing it early.
            self._set(progress=start + min(share - 1, share * lines // (lines + 20)))
            if self.cancelled.is_set():
                process.terminate()
        process.wait()
        if self.cancelled.is_set():
            raise RuntimeError("cancelled")
        if process.returncode:
            raise RuntimeError("\n".join(line for line in tail if line) or "安装步骤失败")


def install_layout_install_routes(app, settings, auth, human):
    INSTALLER = app.state.layout_installer = Installer()

    @app.get("/api/v1/layout-install")
    def layout_install_status(a=Depends(auth)):
        human(a)
        return INSTALLER.status(settings)

    @app.post("/api/v1/layout-install")
    def layout_install_start(a=Depends(auth)):
        human(a)
        try:
            return INSTALLER.start(settings)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    @app.post("/api/v1/layout-install/cancel")
    def layout_install_cancel(a=Depends(auth)):
        human(a)
        return INSTALLER.cancel(settings)
