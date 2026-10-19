"""open-paper-reader: run the whole app on this computer with one command.

    uvx open-paper-reader          # or: pipx install open-paper-reader; opr

Data lives in ~/.open-paper-reader (Windows: %APPDATA%\\open-paper-reader). The
server listens on 127.0.0.1 only and signs its one reader in by itself.
"""

import argparse
import contextlib
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from ..filelock import lock_nowait
from .paths import PACKAGE, agent_runtime_dir, data_dir
from .supervisor import Supervisor

WORKERS = ("agent_worker", "preparation_worker", "translation_worker")
NODE_MAJOR = 20
NODE_HELP = (
    "The assistant needs Node.js {major} or newer, and {found}.\n"
    "  macOS:   brew install node        (or https://nodejs.org)\n"
    "  Windows: winget install OpenJS.NodeJS.LTS\n"
    "  Linux:   your package manager, or https://nodejs.org\n"
    "Reading, highlights and notes work without it; the assistant, guides and\n"
    "translations start once Node.js is installed and Open Paper Reader restarts."
)


def version():
    from importlib.metadata import PackageNotFoundError, version as installed

    try:
        return installed("open-paper-reader")
    except PackageNotFoundError:
        return "dev"


def say(message):
    print(message, flush=True)


def configure(data, host, port):
    """Environment for the web process and every worker it starts."""
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    env = {
        "APP_MODE": "local",
        "APP_ENV": "development",
        "APP_HOST": host,
        "APP_ORIGIN": f"http://{host}:{port}",
        "DATABASE_URL": "sqlite:///" + (data / "workspace.db").as_posix(),
        "STORAGE_DIR": str(data / "files"),
        "LAYOUT_RUNTIME_DIR": str(data / "babeldoc-venv"),
    }
    # One reader on their own disk: the hosted per-user limits do not apply.
    defaults = {"USER_STORAGE_LIMIT_MB": "1048576", "UPLOAD_LIMIT_MB": "200"}
    for key, value in defaults.items():
        os.environ.setdefault(key, value)
    os.environ.update(env)
    # Workers run as `python -m backend.<worker>`; make the package importable
    # from a source checkout as well as from an installed wheel.
    paths = [str(PACKAGE.parent), *filter(None, [os.getenv("PYTHONPATH")])]
    os.environ["PYTHONPATH"] = os.pathsep.join(dict.fromkeys(paths))


def migrate():
    from alembic import command
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", str(PACKAGE / "migrations"))
    command.upgrade(config, "head")


def ensure_reader():
    from argon2 import PasswordHasher

    from ..config import Settings, database
    from .session import local_user

    engine, maker = database(Settings.env())
    with maker() as d:
        name = local_user(d, PasswordHasher()).username
    engine.dispose()
    return name


def node_status():
    """(path to node or None, problem to explain or "")."""
    node = shutil.which(os.getenv("AGENT_NODE", "node"))
    if not node:
        return None, "Node.js was not found"
    try:
        version = subprocess.run(
            [node, "--version"], capture_output=True, text=True, timeout=10
        ).stdout.strip()
        major = int(version.lstrip("v").split(".")[0])
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None, "Node.js did not report its version"
    if major < NODE_MAJOR:
        return None, f"this computer has Node.js {version}"
    return node, ""


def agent_runtime(data, node):
    """A runtime folder with its npm dependencies, installed once per release."""
    source = agent_runtime_dir()
    if (source / "node_modules").is_dir():
        return source
    target = data / "agent-runtime" / version()
    if (target / "node_modules").is_dir():
        return target
    npm = shutil.which("npm") or shutil.which("npm", path=str(Path(node).parent))
    if not npm:
        raise RuntimeError("npm was not found next to Node.js")
    say("Installing the assistant runtime (first start only)…")
    partial = target.with_name(target.name + ".partial")
    shutil.rmtree(partial, ignore_errors=True)
    shutil.copytree(source, partial, ignore=shutil.ignore_patterns("node_modules"))
    subprocess.run(
        [npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd=partial,
        check=True,
    )
    shutil.rmtree(target, ignore_errors=True)
    partial.rename(target)
    return target


def running(url):
    try:
        with urllib.request.urlopen(url + "/api/v1/health", timeout=2) as response:
            return json.loads(response.read()).get("status") == "ok"
    except (OSError, ValueError):
        return False


def claim_instance(data, url):
    """Hold data/instance.lock for the life of this process.

    Returns the open lock file, or None when another instance owns the folder
    (its URL is returned second so we can name it).
    """
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle = (data / "instance.lock").open("a+")
    try:
        lock_nowait(handle)
    except OSError:
        handle.close()
        other = None
        with contextlib.suppress(OSError, ValueError):
            other = (data / "instance.url").read_text().strip() or None
        return None, other
    (data / "instance.url").write_text(url)
    return handle, None


class Server(uvicorn.Server):
    """uvicorn that treats SIGTERM and SIGHUP like Ctrl+C and returns normally."""

    @contextlib.contextmanager
    def capture_signals(self):
        names = ("SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK")
        old = {}
        for name in names:
            number = getattr(signal, name, None)
            if number is None:
                continue
            with contextlib.suppress(ValueError, OSError):
                old[number] = signal.signal(number, self.handle_exit)
        try:
            yield
        finally:
            for number, handler in old.items():
                with contextlib.suppress(ValueError, OSError):
                    signal.signal(number, handler)


def open_when_ready(url, stop_event):
    for _ in range(200):
        if stop_event.is_set():
            return
        if running(url):
            webbrowser.open(url)
            return
        time.sleep(0.1)


def parse(argv):
    parser = argparse.ArgumentParser(
        prog="open-paper-reader",
        description="Read papers with an AI assistant, on this computer.",
    )
    parser.add_argument("--port", type=int, default=int(os.getenv("OPR_PORT", "8765")))
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Loopback address to listen on (the local build never listens on a network)",
    )
    parser.add_argument("--data", type=Path, help="Data folder (default: %(default)s)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser")
    parser.add_argument("--version", action="version", version=version())
    args = parser.parse_args(argv)
    from ..config import is_loopback

    if not is_loopback(args.host):
        parser.error("--host must be a loopback address such as 127.0.0.1")
    if args.host == "::1":
        parser.error("use 127.0.0.1 or localhost")
    return args


def main(argv=None):
    args = parse(argv)
    data = (args.data or data_dir()).expanduser().resolve()
    url = f"http://{args.host}:{args.port}"
    instance, other = claim_instance(data, url)
    if instance is None:
        say(
            f"Open Paper Reader is already running at {other or 'another address'} "
            f"(this data folder is in use: {data}). Stop it first, or use another --data folder."
        )
        return 1
    if running(url):
        instance.close()
        say(f"Open Paper Reader is already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return 0
    configure(data, args.host, args.port)
    say(f"Data folder: {data}")
    migrate()
    reader = ensure_reader()

    node, problem = node_status()
    agent = False
    if node:
        try:
            os.environ["AGENT_RUNTIME_DIR"] = str(agent_runtime(data, node))
            os.environ["AGENT_NODE"] = node
            agent = True
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            say(f"The assistant runtime could not be installed: {error}")
    else:
        say(NODE_HELP.format(major=NODE_MAJOR, found=problem.lower()))
    if not shutil.which("docker"):
        say("Docker was not found: the assistant's code sandbox (terminal tools) is off.")

    from ..main import app

    workers = Supervisor(
        WORKERS if agent else tuple(w for w in WORKERS if w != "agent_worker"),
        PACKAGE.parent,
        log=say,
    )
    workers.start()
    stopping = threading.Event()
    if not args.no_browser:
        threading.Thread(
            target=open_when_ready, args=(url, stopping), daemon=True
        ).start()
    say(f"Open Paper Reader is running at {url} as “{reader}”. Press Ctrl+C to stop.")
    server = Server(
        uvicorn.Config(
            app,
            host=args.host,
            port=args.port,
            log_level="warning",
            access_log=False,
        )
    )
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    finally:
        stopping.set()
        workers.stop()
        instance.close()
    say("Stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
