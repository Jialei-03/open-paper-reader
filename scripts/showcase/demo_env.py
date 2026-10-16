"""Settings shared by the showcase scripts."""

import os
from pathlib import Path

DEMO = Path(os.environ.get("DEMO_DIR", "/tmp/zhijian-demo"))


def demo_password():
    """The throwaway demo account's password: DEMO_PASSWORD, or the file that
    build_demo.sh generated for this demo workspace."""
    value = os.environ.get("DEMO_PASSWORD")
    if value:
        return value
    return (DEMO / "password").read_text().strip()
