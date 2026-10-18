"""Where the local build keeps its data and finds its bundled pieces."""

import os
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]  # the backend package
CHECKOUT = PACKAGE.parent  # repository root when running from source
BUNDLE = PACKAGE / "_bundle"  # filled in by the wheel build (pyproject.toml)


def data_dir():
    """~/.open-paper-reader, or %APPDATA%\\open-paper-reader on Windows."""
    override = os.getenv("OPR_HOME")
    if override:
        return Path(override).expanduser()
    if sys.platform == "win32" and os.getenv("APPDATA"):
        return Path(os.environ["APPDATA"]) / "open-paper-reader"
    return Path.home() / ".open-paper-reader"


def _checkout_or_bundle(name, marker):
    source = CHECKOUT / name
    return source if (source / marker).exists() else BUNDLE / name


def frontend_dir():
    """The web app folder holding dist/: the checkout's, else the wheel's copy."""
    override = os.getenv("OPR_FRONTEND_DIR")
    if override:
        return Path(override)
    return _checkout_or_bundle("frontend", "package.json")


def agent_runtime_dir():
    """The assistant runtime sources (runner.mjs, skills, pi-tools.json)."""
    override = os.getenv("AGENT_RUNTIME_DIR")
    if override:
        return Path(override)
    return _checkout_or_bundle("agent-runtime", "package.json")
