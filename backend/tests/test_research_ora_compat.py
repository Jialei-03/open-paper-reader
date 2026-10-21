"""The files sent to research machines run on their own Python, which on lab
servers is often 3.6 (Ubuntu 18.04): nothing in them may need 3.7 or newer."""

import ast
from pathlib import Path

REMOTE = sorted((Path(__file__).parents[1] / "research_ora").glob("*.py"))
# Keyword arguments of the standard library that 3.6 does not have.
NEWER = {"text", "capture_output"}


def test_the_files_sent_to_research_machines_run_on_python_3_6():
    assert REMOTE
    for path in REMOTE:
        tree = ast.parse(path.read_text(), feature_version=(3, 6))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                used = {k.arg for k in node.keywords} & NEWER
                assert not used, f"{path.name}:{node.lineno} uses {used}"
            assert not isinstance(node, ast.NamedExpr), f"{path.name}: walrus"
