"""LaTeX translation's TeX engine (Tectonic), installed on demand by the local build.

The hosted site compiles translated arXiv sources with latexmk + XeLaTeX in a
container image (TRANSLATION_TEX_IMAGE, deploy/translation/Dockerfile). The
local build has no image: the reader presses "Install LaTeX translation" and
the single Tectonic binary is downloaded from its official GitHub release for
this computer into ``<data dir>/tools/tectonic``. Tectonic is XeTeX-based, so
the same XeLaTeX-oriented source fixes apply, and it fetches the TeX packages
and fonts a paper needs (including ctex's Fandol fonts, which the hosted image
uses too) on first use. The download goes to a temporary folder that is renamed
into place only when every step succeeded, so a cancelled or failed install
leaves nothing half-done.
"""

import io
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

from fastapi import Depends, HTTPException

TECTONIC_VERSION = "0.15.0"
RELEASES = "https://github.com/tectonic-typesetting/tectonic/releases/download"
# A tiny document that loads ctex the way translated papers do: the first
# compile fetches the engine's format files, ctex and the Fandol CJK fonts.
WARMUP = r"""\documentclass{article}
\PassOptionsToPackage{fontset=fandol}{ctex}
\usepackage[UTF8]{ctex}
\begin{document}
中文 PDF 编译检查 LaTeX
\end{document}
"""


def tools_dir(settings):
    override = os.getenv("LATEX_TOOLS_DIR")
    return Path(override) if override else Path(settings.storage).parent / "tools" / "tectonic"


def binary_name():
    return "tectonic.exe" if sys.platform == "win32" else "tectonic"


def binary(settings):
    return tools_dir(settings) / binary_name()


def installed(settings):
    folder = tools_dir(settings)
    return (folder / "installed.json").is_file() and (folder / binary_name()).is_file()


def latex_available(settings):
    """Whether a LaTeX translation job can be compiled on this server."""
    if settings.mode != "local":
        # The hosted site compiles in its TeX image, as it always has.
        return True
    return installed(settings)


def latex_installable(settings):
    return settings.mode == "local" and not installed(settings)


def latex_runtime(settings):
    """The Tectonic binary the worker compiles with, or None for the container."""
    if settings.mode != "local" or not installed(settings):
        return None
    return str(binary(settings))


def release_asset(system=None, machine=None):
    """The release file for this OS and processor; ValueError where there is none."""
    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    arch = {"arm64": "aarch64", "aarch64": "aarch64", "x86_64": "x86_64", "amd64": "x86_64"}.get(machine)
    target = {
        ("darwin", "aarch64"): "aarch64-apple-darwin",
        ("darwin", "x86_64"): "x86_64-apple-darwin",
        ("linux", "aarch64"): "aarch64-unknown-linux-musl",
        ("linux", "x86_64"): "x86_64-unknown-linux-musl",
        ("windows", "x86_64"): "x86_64-pc-windows-msvc",
    }.get((system, arch))
    if not target:
        raise ValueError(f"Tectonic 没有适用于这台电脑（{system} {machine}）的版本")
    suffix = "zip" if system == "windows" else "tar.gz"
    name = f"tectonic-{TECTONIC_VERSION}-{target}.{suffix}"
    return f"{RELEASES}/tectonic%40{TECTONIC_VERSION}/{name}"


def fetch(url, write, cancelled, report):
    """Download url into write(), reporting (done, total) and stopping when cancelled."""
    request = urllib.request.Request(url, headers={"User-Agent": "open-paper-reader"})
    with urllib.request.urlopen(request, timeout=60) as response:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while True:
            if cancelled():
                raise RuntimeError("cancelled")
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            write(chunk)
            done += len(chunk)
            report(done, total)


def unpack(raw, folder):
    """Take the one tectonic binary out of the release archive."""
    name = binary_name()
    target = folder / name
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            member = next((m for m in archive.namelist() if Path(m).name == name), None)
            if not member:
                raise ValueError("下载的 Tectonic 压缩包里没有可执行文件")
            target.write_bytes(archive.read(member))
    else:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
            member = next(
                (m for m in archive.getmembers() if m.isfile() and Path(m.name).name == name),
                None,
            )
            if not member:
                raise ValueError("下载的 Tectonic 压缩包里没有可执行文件")
            target.write_bytes(archive.extractfile(member).read())
    target.chmod(0o755)
    return target


def tex_env(settings):
    """What Tectonic sees: no host secrets, its cache next to the binary."""
    env = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"}
    }
    env["TECTONIC_CACHE_DIR"] = str(tools_dir(settings).with_name("tectonic-cache"))
    return env


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
            "available": latex_available(settings),
        }

    def start(self, settings):
        if settings.mode != "local":
            raise HTTPException(409, "只有本机版需要安装 LaTeX 编译器")
        if installed(settings):
            return self.status(settings)
        with self.lock:
            if self.state["status"] == "running":
                return {**self.state}
            self.cancelled.clear()
            self.state = {"status": "running", "stage": "download", "progress": 0, "error": ""}
            self.thread = threading.Thread(
                target=self._run, args=(settings,), daemon=True, name="latex-install"
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
        target = tools_dir(settings)
        partial = target.with_name(target.name + ".partial")
        shutil.rmtree(partial, ignore_errors=True)
        partial.mkdir(parents=True, exist_ok=True)
        try:
            url = release_asset()
            data = bytearray()

            def report(done, total):
                if total:
                    self._set(progress=min(59, done * 60 // total))

            fetch(url, data.extend, self.cancelled.is_set, report)
            self._set(stage="unpack", progress=60)
            program = unpack(bytes(data), partial)
            self._set(stage="assets", progress=65)
            self._warm_up(settings, program)
            self._set(stage="finish", progress=99)
            (partial / "installed.json").write_text(
                json.dumps({"version": TECTONIC_VERSION, "url": url, "installed_at": time.time()})
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

    def _warm_up(self, settings, program):
        """Compile a small Chinese document once: fetches the packages and fonts, and proves they work."""
        if self.cancelled.is_set():
            raise RuntimeError("cancelled")
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "warmup.tex").write_text(WARMUP, encoding="utf-8")
            process = subprocess.Popen(
                [str(program), "-X", "compile", "--untrusted", "warmup.tex"],
                cwd=folder,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                env=tex_env(settings),
            )
            with self.lock:
                self.process = process
            tail = []
            lines = 0
            for line in process.stdout:
                tail = (tail + [line.rstrip()])[-8:]
                lines += 1
                self._set(progress=65 + min(33, 34 * lines // (lines + 40)))
                if self.cancelled.is_set():
                    process.terminate()
            process.wait()
            if self.cancelled.is_set():
                raise RuntimeError("cancelled")
            if process.returncode or not (Path(folder) / "warmup.pdf").is_file():
                raise RuntimeError("\n".join(line for line in tail if line) or "中文编译检查失败")


def install_latex_install_routes(app, settings, auth, human):
    INSTALLER = app.state.latex_installer = Installer()

    @app.get("/api/v1/latex-install")
    def latex_install_status(a=Depends(auth)):
        human(a)
        return INSTALLER.status(settings)

    @app.post("/api/v1/latex-install")
    def latex_install_start(a=Depends(auth)):
        human(a)
        try:
            return INSTALLER.start(settings)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    @app.post("/api/v1/latex-install/cancel")
    def latex_install_cancel(a=Depends(auth)):
        human(a)
        return INSTALLER.cancel(settings)
